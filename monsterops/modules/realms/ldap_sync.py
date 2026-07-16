
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import ldap3
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.modules.nas_manager.crypto import decrypt
from monsterops.modules.realms import ldap_probe
from monsterops.modules.realms.enforcement import adapter
from monsterops.modules.realms.models import (
    MrAuthDomain,
    MrAuthGroupMap,
    MrAuthSyncedUser,
    MrIdentitySource,
)

logger = logging.getLogger(__name__)

_PAGE_SIZE = 500
_SAMPLE_CAP = 100
_GROUP_CAP = 1000
UAC_ACCOUNTDISABLE = 0x2


def _cn_of(dn: str) -> str:
    head = dn.split(",", 1)[0]
    return head.split("=", 1)[1] if "=" in head else head


def _first(val) -> str:
    if isinstance(val, (list, tuple)):
        return str(val[0]) if val else ""
    return "" if val is None else str(val)




def _fetch_ad_users(src: MrIdentitySource, password: str | None) -> list[dict]:
    conn = ldap_probe.connect(
        host=src.host,
        port=src.port,
        encryption=src.encryption,
        bind_dn=src.bind_dn,
        bind_password=password,
        tls_verify=src.tls_verify,
        timeout=src.timeout,
    )
    login_attr = src.login_attribute
    base = src.user_search_base or src.base_dn
    users: list[dict] = []
    try:
        entries = conn.extend.standard.paged_search(
            search_base=base,
            search_filter=src.user_search_filter,
            search_scope=ldap3.SUBTREE,
            attributes=[
                login_attr,
                "objectGUID",
                "userAccountControl",
                "memberOf",
                "distinguishedName",
            ],
            paged_size=_PAGE_SIZE,
            generator=True,
        )
        for e in entries:
            if e.get("type") != "searchResEntry":
                continue
            attrs = e.get("attributes") or {}
            raw = e.get("raw_attributes") or {}
            guid_raw = (raw.get("objectGUID") or [None])[0]
            if guid_raw is None:
                continue
            guid = guid_raw.hex() if isinstance(guid_raw, (bytes, bytearray)) else str(guid_raw)

            username = _first(attrs.get(login_attr)).strip()
            if src.strip_login_suffix and "@" in username:
                username = username.split("@", 1)[0]
            if not username:
                continue

            try:
                uac = int(_first(attrs.get("userAccountControl")) or 0)
            except (ValueError, TypeError):
                uac = 0
            enabled = not (uac & UAC_ACCOUNTDISABLE)

            member_of = attrs.get("memberOf") or []
            if isinstance(member_of, str):
                member_of = [member_of]

            users.append(
                {
                    "guid": guid,
                    "username": username,
                    "enabled": enabled,
                    "dn": e.get("dn") or str(attrs.get("distinguishedName") or ""),
                    "groups": [str(g) for g in member_of],
                }
            )
    finally:
        try:
            conn.unbind()
        except Exception:
            pass
    return users


def fetch_ad_groups(src: MrIdentitySource, password: str | None) -> list[dict]:
    conn = ldap_probe.connect(
        host=src.host,
        port=src.port,
        encryption=src.encryption,
        bind_dn=src.bind_dn,
        bind_password=password,
        tls_verify=src.tls_verify,
        timeout=src.timeout,
    )
    groups: list[dict] = []
    try:
        entries = conn.extend.standard.paged_search(
            search_base=src.base_dn,
            search_filter="(objectClass=group)",
            search_scope=ldap3.SUBTREE,
            attributes=["cn", "distinguishedName"],
            paged_size=_PAGE_SIZE,
            generator=True,
        )
        for e in entries:
            if e.get("type") != "searchResEntry":
                continue
            attrs = e.get("attributes") or {}
            dn = e.get("dn") or str(attrs.get("distinguishedName") or "")
            if not dn:
                continue
            cn = _first(attrs.get("cn")) or _cn_of(dn)
            groups.append({"cn": str(cn), "dn": str(dn)})
            if len(groups) >= _GROUP_CAP:
                break
    finally:
        try:
            conn.unbind()
        except Exception:
            pass
    groups.sort(key=lambda g: g["cn"].lower())
    return groups


def _resolve_group(
    user_groups: list[str], mappings: list[MrAuthGroupMap], default_group: str | None
) -> str | None:
    member_dns = {g.lower() for g in user_groups}
    member_cns = {_cn_of(g).lower() for g in user_groups}
    matched = [
        m for m in mappings if m.ad_group.lower() in member_dns or m.ad_group.lower() in member_cns
    ]
    if matched:
        return str(sorted(matched, key=lambda m: (m.priority, m.id))[0].groupname)
    return default_group




async def sync_auth_domain(db: AsyncSession, auth_domain_id: int, *, dry_run: bool = False) -> dict:
    stats = {
        "status": "ok",
        "dry_run": dry_run,
        "created": 0,
        "updated": 0,
        "reactivated": 0,
        "disabled": 0,
        "removed": 0,
        "unchanged": 0,
        "errors": 0,
        "message": None,
        "sample": [],
    }

    def note(line: str) -> None:
        if len(stats["sample"]) < _SAMPLE_CAP:
            stats["sample"].append(line)

    d = await db.get(MrAuthDomain, auth_domain_id)
    if d is None:
        stats["status"] = "error"
        stats["message"] = "realm not found"
        return stats
    if d.identity_source_id is None:
        stats["status"] = "error"
        stats["message"] = "realm has no identity source to sync from"
        await _finish(db, d, stats, dry_run)
        return stats
    src = await db.get(MrIdentitySource, d.identity_source_id)
    if src is None:
        stats["status"] = "error"
        stats["message"] = "identity source not found"
        await _finish(db, d, stats, dry_run)
        return stats

    password = None
    if src.bind_password_enc:
        try:
            password = decrypt(src.bind_password_enc, settings.secret_key)
        except Exception:
            stats["status"] = "error"
            stats["message"] = "failed to decrypt bind password"
            await _finish(db, d, stats, dry_run)
            return stats

    try:
        ad_users = await asyncio.to_thread(_fetch_ad_users, src, password)
    except Exception as exc:
        logger.warning("Sync fetch failed for realm '%s': %s", d.name, exc)
        stats["status"] = "error"
        stats["message"] = f"directory read failed: {exc}"
        await _finish(db, d, stats, dry_run)
        return stats

    mappings = list(
        (await db.execute(select(MrAuthGroupMap).where(MrAuthGroupMap.auth_domain_id == d.id)))
        .scalars()
        .all()
    )
    prov_rows = list(
        (await db.execute(select(MrAuthSyncedUser).where(MrAuthSyncedUser.auth_domain_id == d.id)))
        .scalars()
        .all()
    )
    by_guid = {p.ad_object_guid: p for p in prov_rows}

    now = datetime.now(tz=timezone.utc)
    seen: set[str] = set()

    for u in ad_users:
        guid, username, enabled = u["guid"], u["username"], u["enabled"]
        seen.add(guid)
        groupname = _resolve_group(u["groups"], mappings, d.default_groupname)
        prov = by_guid.get(guid)

        if prov is None:
            if d.import_mode == "selected":
                continue
            if await adapter.username_exists(db, username):
                stats["errors"] += 1
                note(f"! skip {username}: username already exists (not realm-managed)")
                continue
            stats["created"] += 1
            note(
                f"+ create {username}"
                + (f" group={groupname}" if groupname else "")
                + ("" if enabled else " [disabled]")
            )
            if not dry_run:
                await adapter.materialize(
                    db, username=username, auth_method=d.auth_method, enabled=enabled
                )
                await adapter.set_entitlements(db, username, groupname)
                db.add(
                    MrAuthSyncedUser(
                        auth_domain_id=d.id,
                        ad_object_guid=guid,
                        username=username,
                        ad_dn=u["dn"],
                        ad_enabled=enabled,
                        groupname=groupname,
                        last_seen_at=now,
                        created_at=now,
                    )
                )
            continue

        changed = False
        if prov.username != username:
            note(f"~ rename {prov.username} → {username}")
            if not dry_run:
                await adapter.rename(db, prov.username, username)
                prov.username = username
            changed = True
        if prov.groupname != groupname:
            note(f"~ group {username}: {prov.groupname or '-'} → {groupname or '-'}")
            if not dry_run:
                await adapter.set_entitlements(db, username, groupname)
                prov.groupname = groupname
            changed = True

        currently_enabled = await adapter.is_enabled(db, username)
        if enabled and not currently_enabled:
            stats["reactivated"] += 1
            note(f"^ reactivate {username}")
            if not dry_run:
                await adapter.materialize(
                    db, username=username, auth_method=d.auth_method, enabled=True
                )
            changed = True
        elif not enabled and currently_enabled:
            stats["disabled"] += 1
            note(f"v disable {username} (directory-disabled)")
            if not dry_run:
                await adapter.materialize(
                    db, username=username, auth_method=d.auth_method, enabled=False
                )
            changed = True

        if changed:
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1
        if not dry_run:
            prov.last_seen_at = now
            prov.ad_enabled = enabled
            prov.ad_dn = u["dn"]

    for prov in prov_rows:
        if prov.ad_object_guid in seen:
            continue
        stats["removed"] += 1
        if d.deprovision_action == "delete":
            note(f"- delete {prov.username} (gone from directory)")
            if not dry_run:
                await adapter.deprovision(db, prov.username, "delete")
                await db.delete(prov)
        else:
            note(f"v disable {prov.username} (gone from directory)")
            if not dry_run:
                await adapter.deprovision(db, prov.username, "disable")
                prov.ad_enabled = False

    await _finish(db, d, stats, dry_run)
    return stats




async def _resolve_source(db: AsyncSession, d: MrAuthDomain) -> tuple[MrIdentitySource, str | None]:
    if d.identity_source_id is None:
        raise ValueError("realm has no identity source")
    src = await db.get(MrIdentitySource, d.identity_source_id)
    if src is None:
        raise ValueError("identity source not found")
    password = None
    if src.bind_password_enc:
        try:
            password = decrypt(src.bind_password_enc, settings.secret_key)
        except Exception as exc:
            raise ValueError("failed to decrypt bind password") from exc
    return src, password


async def list_import_candidates(db: AsyncSession, auth_domain_id: int) -> dict:
    d = await db.get(MrAuthDomain, auth_domain_id)
    if d is None:
        return {"status": "error", "message": "realm not found", "total": 0, "candidates": []}
    try:
        src, password = await _resolve_source(db, d)
        ad_users = await asyncio.to_thread(_fetch_ad_users, src, password)
    except ValueError as exc:
        return {"status": "error", "message": str(exc), "total": 0, "candidates": []}
    except Exception as exc:
        return {
            "status": "error",
            "message": f"directory read failed: {exc}",
            "total": 0,
            "candidates": [],
        }

    mappings = list(
        (await db.execute(select(MrAuthGroupMap).where(MrAuthGroupMap.auth_domain_id == d.id)))
        .scalars()
        .all()
    )
    imported = set(
        (
            await db.execute(
                select(MrAuthSyncedUser.ad_object_guid).where(
                    MrAuthSyncedUser.auth_domain_id == d.id
                )
            )
        )
        .scalars()
        .all()
    )

    candidates = [
        {
            "guid": u["guid"],
            "username": u["username"],
            "enabled": u["enabled"],
            "group": _resolve_group(u["groups"], mappings, d.default_groupname),
            "dn": u["dn"],
            "imported": u["guid"] in imported,
        }
        for u in ad_users
    ]
    return {"status": "ok", "message": None, "total": len(candidates), "candidates": candidates}


async def import_selected_users(db: AsyncSession, auth_domain_id: int, guids: list[str]) -> dict:
    stats = {
        "status": "ok",
        "dry_run": False,
        "created": 0,
        "updated": 0,
        "reactivated": 0,
        "disabled": 0,
        "removed": 0,
        "unchanged": 0,
        "errors": 0,
        "message": None,
        "sample": [],
    }

    def note(line: str) -> None:
        if len(stats["sample"]) < _SAMPLE_CAP:
            stats["sample"].append(line)

    d = await db.get(MrAuthDomain, auth_domain_id)
    if d is None:
        stats["status"] = "error"
        stats["message"] = "realm not found"
        return stats
    try:
        src, password = await _resolve_source(db, d)
        ad_users = await asyncio.to_thread(_fetch_ad_users, src, password)
    except ValueError as exc:
        stats["status"] = "error"
        stats["message"] = str(exc)
        await _finish(db, d, stats, dry_run=False)
        return stats
    except Exception as exc:
        stats["status"] = "error"
        stats["message"] = f"directory read failed: {exc}"
        await _finish(db, d, stats, dry_run=False)
        return stats

    mappings = list(
        (await db.execute(select(MrAuthGroupMap).where(MrAuthGroupMap.auth_domain_id == d.id)))
        .scalars()
        .all()
    )
    existing_guids = set(
        (
            await db.execute(
                select(MrAuthSyncedUser.ad_object_guid).where(
                    MrAuthSyncedUser.auth_domain_id == d.id
                )
            )
        )
        .scalars()
        .all()
    )

    wanted = set(guids)
    now = datetime.now(tz=timezone.utc)
    for u in ad_users:
        if u["guid"] not in wanted:
            continue
        if u["guid"] in existing_guids:
            stats["unchanged"] += 1
            continue
        username, enabled = u["username"], u["enabled"]
        groupname = _resolve_group(u["groups"], mappings, d.default_groupname)
        if await adapter.username_exists(db, username):
            stats["errors"] += 1
            note(f"! skip {username}: username already exists (not realm-managed)")
            continue
        stats["created"] += 1
        note(
            f"+ import {username}"
            + (f" group={groupname}" if groupname else "")
            + ("" if enabled else " [disabled]")
        )
        await adapter.materialize(db, username=username, auth_method=d.auth_method, enabled=enabled)
        await adapter.set_entitlements(db, username, groupname)
        db.add(
            MrAuthSyncedUser(
                auth_domain_id=d.id,
                ad_object_guid=u["guid"],
                username=username,
                ad_dn=u["dn"],
                ad_enabled=enabled,
                groupname=groupname,
                last_seen_at=now,
                created_at=now,
            )
        )

    await _finish(db, d, stats, dry_run=False)
    return stats


async def _finish(db: AsyncSession, d: MrAuthDomain, stats: dict, dry_run: bool) -> None:
    if dry_run:
        await db.rollback()
        return
    from monsterops.modules.scheduler.models import ReportRun

    now = datetime.now(tz=timezone.utc)
    d.last_sync_at = now
    d.last_sync_status = stats["status"]
    d.last_sync_stats = {
        k: stats[k]
        for k in (
            "created",
            "updated",
            "reactivated",
            "disabled",
            "removed",
            "unchanged",
            "errors",
        )
    }
    db.add(
        ReportRun(
            job_id=None,
            job_name=d.name,
            job_type="ldap_sync",
            run_at=now,
            status=stats["status"],
            data=d.last_sync_stats,
            error_message=stats["message"],
        )
    )
    await db.commit()


async def run_scheduled_sync(auth_domain_id: int) -> None:
    from monsterops.database import SessionLocal

    async with SessionLocal() as db:
        try:
            stats = await sync_auth_domain(db, auth_domain_id)
            logger.info(
                "Realm sync (%s): %s",
                auth_domain_id,
                {k: stats[k] for k in ("created", "updated", "disabled", "removed", "errors")},
            )
        except Exception:
            logger.exception("Scheduled sync failed for realm %s", auth_domain_id)
