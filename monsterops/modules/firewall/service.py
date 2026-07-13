from __future__ import annotations

import asyncio
import difflib
import json
import logging
import secrets
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from monsterops.modules.firewall import nft
from monsterops.modules.firewall.generator import generate_ruleset
from monsterops.modules.firewall.models import (
    MrFirewallConfig,
    MrFirewallRule,
    MrFirewallSet,
    MrFirewallSnapshot,
)

logger = logging.getLogger(__name__)

_pending: dict[str, dict] = {}


async def get_config(db: AsyncSession) -> MrFirewallConfig:
    cfg = await db.get(MrFirewallConfig, 1)
    if cfg is not None:
        return cfg
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    await db.execute(pg_insert(MrFirewallConfig).values(id=1).on_conflict_do_nothing())
    await db.commit()
    cfg = await db.get(MrFirewallConfig, 1)
    assert cfg is not None
    return cfg


async def list_rules(db: AsyncSession) -> list[MrFirewallRule]:
    return list((await db.execute(
        select(MrFirewallRule).order_by(MrFirewallRule.position, MrFirewallRule.id)
    )).scalars().all())


async def list_sets(db: AsyncSession) -> list[MrFirewallSet]:
    return list((await db.execute(
        select(MrFirewallSet).options(selectinload(MrFirewallSet.entries)).order_by(MrFirewallSet.name)
    )).scalars().all())


async def render(db: AsyncSession, guard_ips: list[str] | None = None) -> str:
    cfg = await get_config(db)
    rules = await list_rules(db)
    sets = await list_sets(db)
    return generate_ruleset(cfg, rules, sets, guard_ips or [])



def _boot_path() -> str:
    from monsterops.config import settings
    return settings.firewall_ruleset_path


def _write_file_sync(path: str, text: str) -> None:
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    os.chmod(path, 0o640)


async def persist_boot_ruleset(db: AsyncSession) -> None:
    import os

    path = _boot_path()
    loop = asyncio.get_event_loop()
    try:
        cfg = await get_config(db)
        if cfg.managed:
            ruleset = await render(db, guard_ips=[])
            await loop.run_in_executor(None, _write_file_sync, path, ruleset)
        elif os.path.exists(path):
            await loop.run_in_executor(None, os.remove, path)
    except Exception:
        logger.warning("Firewall: could not update boot ruleset at %s", path, exc_info=True)


async def preview(db: AsyncSession, guard_ips: list[str] | None = None) -> dict:
    ruleset = await render(db, guard_ips)
    if not nft.nft_available():
        return {"ruleset": ruleset, "valid": False, "error": "nft binary not installed", "diff": ""}
    valid, err = await nft.check(ruleset)
    active_ok, active = await nft.list_table()
    body = _strip_prefix(ruleset)
    diff = "\n".join(difflib.unified_diff(
        (active or "").splitlines(), body.splitlines(),
        fromfile="active", tofile="proposed", lineterm="",
    )) if active_ok else ""
    return {"ruleset": ruleset, "valid": valid, "error": err, "diff": diff}


def _strip_prefix(ruleset: str) -> str:
    lines = ruleset.splitlines()
    return "\n".join(ln for ln in lines
                     if not ln.startswith(("add table", "delete table")))


async def apply_with_rollback(db: AsyncSession, actor: str, guard_ips: list[str] | None = None) -> dict:
    if not nft.nft_available():
        raise RuntimeError("nft binary not installed on this host")

    cfg = await get_config(db)
    ruleset = await render(db, guard_ips)
    valid, err = await nft.check(ruleset)
    if not valid:
        raise ValueError(f"generated ruleset failed validation: {err}")

    _ok, active = await nft.list_table()
    snap = MrFirewallSnapshot(nft_text=active or "", actor=actor, note="pre-apply")
    db.add(snap)
    await db.commit()
    await db.refresh(snap)

    ok, apply_err = await nft.apply(ruleset)
    if not ok:
        raise RuntimeError(f"nft apply failed: {apply_err}")

    cfg.managed = True
    cfg.last_applied_at = datetime.now(timezone.utc)
    await db.commit()

    token = secrets.token_urlsafe(12)
    timeout = int(cfg.confirm_timeout)
    task = asyncio.create_task(_rollback_after(token, snap.nft_text, timeout))
    _pending[token] = {"task": task, "snapshot_id": snap.id, "at": datetime.now(timezone.utc)}
    logger.info("Firewall applied by %s; rollback armed for %ds (token=%s)", actor, timeout, token)
    return {"token": token, "confirm_timeout": timeout}


async def _rollback_after(token: str, snapshot_text: str, timeout: int) -> None:
    try:
        await asyncio.sleep(timeout)
    except asyncio.CancelledError:
        return
    logger.warning("Firewall apply NOT confirmed within %ds — rolling back (token=%s)", timeout, token)
    await _restore(snapshot_text)
    _pending.pop(token, None)


async def _restore(snapshot_text: str) -> None:
    if snapshot_text.strip():
        rs = f"add table inet monsterops\ndelete table inet monsterops\n{snapshot_text}"
        await nft.apply(rs)
    else:
        await nft.delete_table()


def confirm(token: str) -> bool:
    entry = _pending.pop(token, None)
    if not entry:
        return False
    entry["task"].cancel()
    logger.info("Firewall apply confirmed (token=%s)", token)
    return True


def pending_confirmations() -> list[dict]:
    return [{"token": t, "at": e["at"].isoformat()} for t, e in _pending.items()]


async def rollback_now(db: AsyncSession) -> bool:
    snap = (await db.execute(
        select(MrFirewallSnapshot).order_by(MrFirewallSnapshot.id.desc()).limit(1)
    )).scalar_one_or_none()
    if snap is None:
        return False
    for token in list(_pending):
        confirm(token)
    await _restore(snap.nft_text)
    return True


async def counters(db: AsyncSession) -> dict:
    if not nft.nft_available():
        return {"available": False, "rules": [], "sets": []}
    ok, out = await nft.list_table_json()
    if not ok or not out:
        return {"available": True, "active": False, "rules": [], "sets": []}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {"available": True, "active": True, "rules": [], "sets": []}

    rule_ctrs, set_sizes, total_dropped = [], {}, 0
    for item in data.get("nftables", []):
        if "rule" in item:
            rule = item["rule"]
            pkts = _find_counter(rule.get("expr", []))
            verdict = _find_verdict(rule.get("expr", []))
            comment = rule.get("comment")
            if pkts:
                rule_ctrs.append({"comment": comment, "action": verdict,
                                  "packets": pkts["packets"], "bytes": pkts["bytes"]})
                if verdict == "drop":
                    total_dropped += pkts["packets"]
        elif "set" in item:
            s = item["set"]
            elems = s.get("elem", [])
            set_sizes[s.get("name")] = len(elems)
    return {"available": True, "active": True, "rules": rule_ctrs,
            "sets": set_sizes, "total_dropped": total_dropped}


def _find_counter(exprs: list) -> dict | None:
    for e in exprs:
        if isinstance(e, dict) and "counter" in e:
            c = e["counter"]
            if isinstance(c, dict):
                return {"packets": c.get("packets", 0), "bytes": c.get("bytes", 0)}
    return None


def _find_verdict(exprs: list) -> str:
    for e in exprs:
        if isinstance(e, dict):
            for v in ("accept", "drop", "reject"):
                if v in e:
                    return v
    return "?"


async def status(db: AsyncSession) -> dict:
    cfg = await get_config(db)
    rules = await list_rules(db)
    sets = await list_sets(db)
    ctrs = await counters(db)
    ban_count = sum(len(s.entries) for s in sets if s.auto_ban)
    return {
        "nft_available": nft.nft_available(),
        "managed": bool(cfg.managed),
        "active": ctrs.get("active", False),
        "rule_count": len(rules),
        "enabled_rule_count": sum(1 for r in rules if r.enabled),
        "set_count": len(sets),
        "ban_count": ban_count,
        "total_dropped": ctrs.get("total_dropped", 0),
        "last_applied_at": cfg.last_applied_at.isoformat() if cfg.last_applied_at else None,
        "pending": pending_confirmations(),
    }


async def add_ban(db: AsyncSession, element: str, ttl_seconds: int | None,
                  set_name: str | None = None, comment: str = "auto-ban") -> MrFirewallSet:
    from datetime import timedelta

    from monsterops.modules.firewall.models import MrFirewallSetEntry

    q = select(MrFirewallSet).options(selectinload(MrFirewallSet.entries))
    if set_name:
        q = q.where(MrFirewallSet.name == set_name)
    else:
        q = q.where(MrFirewallSet.auto_ban == True)  # noqa: E712
    fset = (await db.execute(q.limit(1))).scalar_one_or_none()
    if fset is None:
        raise LookupError("no auto-ban set configured")

    expires = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)) if ttl_seconds else None
    if not any(e.element == element for e in fset.entries):
        db.add(MrFirewallSetEntry(set_id=fset.id, element=element, comment=comment[:120], expires_at=expires))
        await db.commit()
    if nft.nft_available():
        await nft.add_element(fset.name, element, ttl_seconds)
    return fset



NAS_GUARD_SET = "mr_guard_nas"
NAS_GUARD_SOURCE = "guard:nas"


async def provision_nas_guard_set(db: AsyncSession) -> dict:
    import ipaddress

    from monsterops.modules.firewall.models import MrFirewallSetEntry
    from monsterops.modules.nas.models import Nas

    names = (await db.execute(select(Nas.nasname))).scalars().all()
    ips: list[str] = []
    skipped = 0
    seen: set[str] = set()
    for raw in names:
        s = (raw or "").strip()
        try:
            net = ipaddress.ip_network(s, strict=False)
        except ValueError:
            skipped += 1
            continue
        if net.version != 4:
            skipped += 1
            continue
        if s not in seen:
            seen.add(s)
            ips.append(s)

    fset = (await db.execute(
        select(MrFirewallSet).options(selectinload(MrFirewallSet.entries))
        .where(MrFirewallSet.name == NAS_GUARD_SET)
    )).scalar_one_or_none()
    if fset is None:
        fset = MrFirewallSet(name=NAS_GUARD_SET, family="ipv4_addr", kind="allow",
                             auto_ban=False, managed_source=NAS_GUARD_SOURCE,
                             comment="Anti-lockout: known NAS clients (RADIUS)")
        db.add(fset)
        await db.flush()
    else:
        for e in list(fset.entries):
            await db.delete(e)
        await db.flush()

    for ip in ips:
        db.add(MrFirewallSetEntry(set_id=fset.id, element=ip, comment=NAS_GUARD_SOURCE))
    await db.commit()
    logger.info("NAS guard set: %d client(s), %d skipped", len(ips), skipped)
    return {"name": NAS_GUARD_SET, "count": len(ips), "skipped": skipped}



async def find_lockout_ips(
    db: AsyncSession, elements: list[str],
    current_ip: str | None = None, country_code: str | None = None,
) -> dict:
    import ipaddress

    from monsterops.modules.auth.models import AuditLog
    from monsterops.modules.nas.models import Nas

    nets: list = []
    for e in elements or []:
        try:
            nets.append(ipaddress.ip_network(str(e).strip(), strict=False))
        except ValueError:
            continue
    if country_code:
        from monsterops.modules.firewall import geoblock
        try:
            for c in await geoblock.fetch_country_cidrs(country_code):
                try:
                    nets.append(ipaddress.ip_network(c, strict=False))
                except ValueError:
                    continue
        except geoblock.CountryBlockError:
            pass

    if not nets:
        return {"covered": [], "nas": [], "your_ip": current_ip}

    rows = (await db.execute(
        select(AuditLog.ip_address, func.max(AuditLog.created_at))
        .where(AuditLog.ip_address.is_not(None))
        .group_by(AuditLog.ip_address)
    )).all()

    covered: list[dict] = []
    seen: set[str] = set()

    def _consider(ip_str: str | None, last_seen, is_current: bool) -> None:
        if not ip_str or ip_str in seen:
            return
        try:
            ip = ipaddress.ip_address(ip_str.strip())
        except ValueError:
            return
        if ip.is_loopback:
            return
        for net in nets:
            if ip.version == net.version and ip in net:
                seen.add(ip_str)
                covered.append({
                    "ip": ip_str,
                    "last_seen": last_seen.isoformat() if last_seen else None,
                    "current": is_current,
                })
                return

    _consider(current_ip, None, True)
    for ip_str, last in rows:
        _consider(ip_str, last, False)

    nas_hits: list[dict] = []
    seen_nas: set[str] = set()
    for nasname, shortname in (await db.execute(select(Nas.nasname, Nas.shortname))).all():
        s = (nasname or "").strip()
        if not s or s in seen_nas:
            continue
        try:
            nnet = ipaddress.ip_network(s, strict=False)
        except ValueError:
            continue
        if any(nnet.version == net.version and nnet.overlaps(net) for net in nets):
            seen_nas.add(s)
            nas_hits.append({"ip": s, "shortname": shortname or s})

    return {"covered": covered, "nas": nas_hits, "your_ip": current_ip}



async def record_block_event(
    db: AsyncSession, *, element: str, set_name: str,
    source: str = "brute_force", reason: str | None = None,
    ban_seconds: int | None = None,
) -> None:
    from monsterops.modules.firewall.models import MrFirewallBlockEvent

    try:
        db.add(MrFirewallBlockEvent(
            element=element, set_name=set_name[:48], source=source[:32],
            reason=(reason or None) and reason[:200], ban_seconds=ban_seconds,
        ))
        await db.commit()
    except Exception:  # noqa: BLE001 — audit is advisory, never fatal
        logger.warning("Firewall: could not record block event for %s", element, exc_info=True)
        await db.rollback()


async def mark_block_override(
    db: AsyncSession, *, element: str, set_name: str, username: str,
) -> bool:
    from monsterops.modules.firewall.models import MrFirewallBlockEvent

    ev = (await db.execute(
        select(MrFirewallBlockEvent)
        .where(MrFirewallBlockEvent.element == element)
        .where(MrFirewallBlockEvent.set_name == set_name)
        .where(MrFirewallBlockEvent.override_at.is_(None))
        .order_by(MrFirewallBlockEvent.id.desc()).limit(1)
    )).scalar_one_or_none()
    if ev is None:
        return False
    ev.override_by = username[:64]
    ev.override_at = datetime.now(timezone.utc)
    await db.commit()
    return True


async def list_block_events(db: AsyncSession, limit: int = 50) -> list:
    from monsterops.modules.firewall.models import MrFirewallBlockEvent

    return list((await db.execute(
        select(MrFirewallBlockEvent)
        .order_by(MrFirewallBlockEvent.created_at.desc(), MrFirewallBlockEvent.id.desc())
        .limit(max(1, min(limit, 500)))
    )).scalars().all())
