from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from monsterops.config import settings
from monsterops.database import SessionLocal, get_db
from monsterops.modules.auth.models import AdminUser
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.nas.models import Nas
from monsterops.modules.nas_manager.crypto import decrypt, encrypt
from monsterops.modules.nas_manager.history import (
    apply_retention,
    diff_stats,
    store_version,
    unified_diff,
)
from monsterops.modules.nas_manager.models import (
    MrNasConfigVersion,
    MrNasDispatchLog,
    MrNasManager,
)
from monsterops.modules.nas_manager.schemas import (
    ConfigVersionOut,
    DispatchRequest,
    HistorySettingsIn,
    NasManagerCreate,
    NasManagerOut,
    VendorTypesOut,
)
from monsterops.modules.nas_manager.service import (
    pull_config,
    push_config,
    run_command,
    run_command_stream,
    test_connection,
)
from monsterops.modules.nas_manager.vendor_map import (
    VENDOR_MAP,
    apply_conn_type,
    device_types_for,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/nas-manager", tags=["nas-manager"])




async def _get_nm(nas_id: int, db: AsyncSession) -> MrNasManager:
    result = await db.execute(
        select(MrNasManager)
        .where(MrNasManager.nas_id == nas_id)
        .options(selectinload(MrNasManager.nas))
    )
    nm = result.scalar_one_or_none()
    if not nm:
        raise HTTPException(404, "NAS Manager config not found for this NAS")
    return nm


def _decrypt_or_raise(nm: MrNasManager) -> str:
    try:
        return decrypt(nm.secret_enc, settings.secret_key)
    except Exception:
        raise HTTPException(500, "Failed to decrypt stored credentials")




@router.get("/vendor-types")
async def get_vendor_types(
    _: AdminUser = Depends(get_current_user),
) -> list[VendorTypesOut]:
    return [
        VendorTypesOut(
            vendor=vendor,
            device_types=meta["device_types"],
            supported=True,
        )
        for vendor, meta in VENDOR_MAP.items()
    ]




@router.get("")
async def list_managed(
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NasManagerOut]:
    rows = (
        (await db.execute(select(MrNasManager).options(selectinload(MrNasManager.nas))))
        .scalars()
        .all()
    )
    return [NasManagerOut.from_model(r) for r in rows]




@router.get("/{nas_id}")
async def get_managed(
    nas_id: int,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NasManagerOut:
    nm = await _get_nm(nas_id, db)
    return NasManagerOut.from_model(nm)




@router.post("/{nas_id}")
async def upsert_managed(
    nas_id: int,
    body: NasManagerCreate,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> NasManagerOut:
    nas = await db.get(Nas, nas_id)
    if not nas:
        raise HTTPException(404, "NAS device not found")

    vendor = (nas.type or "other").lower()

    if body.netmiko_device_type:
        base_device_type = body.netmiko_device_type
    else:
        candidates = device_types_for(vendor)
        if not candidates:
            raise HTTPException(
                422,
                f"NAS vendor '{vendor}' has no Netmiko mapping and cannot be managed over SSH/Telnet",
            )
        base_device_type = candidates[0]

    device_type = apply_conn_type(base_device_type, body.conn_type)

    host = body.host or (nas.nasname or "").split("/")[0].strip()
    if not host:
        raise HTTPException(422, "Could not determine a management host for this NAS")

    port = body.port or (23 if body.conn_type == "telnet" else 22)

    result = await db.execute(
        select(MrNasManager)
        .where(MrNasManager.nas_id == nas_id)
        .options(selectinload(MrNasManager.nas))
    )
    nm = result.scalar_one_or_none()

    if nm is None:
        if not body.password:
            raise HTTPException(422, "password is required when creating a NAS Manager config")
        nm = MrNasManager(
            nas_id=nas_id,
            enabled=body.enabled,
            conn_type=body.conn_type,
            netmiko_device_type=device_type,
            host=host,
            port=port,
            username=body.username,
            secret_enc=encrypt(body.password, settings.secret_key),
            test_status="untested",
        )
        db.add(nm)
        await db.commit()
        await db.refresh(nm)
        await db.refresh(nm, ["nas"])
        await audit(
            db,
            user_id=current_user.id,
            username=current_user.username,
            action="nas_manager.create",
            target=str(nas_id),
        )
    else:
        nm.enabled = body.enabled
        nm.conn_type = body.conn_type
        nm.netmiko_device_type = device_type
        nm.host = host
        nm.port = port
        nm.username = body.username
        if body.password:
            nm.secret_enc = encrypt(body.password, settings.secret_key)
        await db.commit()
        await db.refresh(nm)
        await db.refresh(nm, ["nas"])
        await audit(
            db,
            user_id=current_user.id,
            username=current_user.username,
            action="nas_manager.update",
            target=str(nas_id),
        )

    asyncio.create_task(_bg_test(nm.id, nm.nas_id))

    return NasManagerOut.from_model(nm)




@router.delete("/{nas_id}", status_code=204)
async def delete_managed(
    nas_id: int,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    nm = await _get_nm(nas_id, db)
    await db.delete(nm)
    await db.commit()
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.delete",
        target=str(nas_id),
    )




@router.post("/{nas_id}/test")
async def trigger_test(
    nas_id: int,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nm = await _get_nm(nas_id, db)
    asyncio.create_task(_bg_test(nm.id, nas_id))
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.test",
        target=str(nas_id),
    )
    return {"ok": True, "detail": "Connection test started in background"}


async def _bg_test(nm_id: int, nas_id: int) -> None:
    from monsterops.database import SessionLocal

    async with SessionLocal() as db:
        result = await db.execute(
            select(MrNasManager)
            .where(MrNasManager.id == nm_id)
            .options(selectinload(MrNasManager.nas))
        )
        nm = result.scalar_one_or_none()
        if not nm:
            return

        try:
            password = decrypt(nm.secret_enc, settings.secret_key)
        except Exception:
            logger.error("NAS Manager: could not decrypt credentials for nas_id=%s", nas_id)
            return

        ok, err = await test_connection(nm, password)
        nm.test_status = "connected" if ok else "failed"
        nm.test_error = err if not ok else None
        nm.last_tested_at = datetime.now(timezone.utc)
        await db.commit()

        if ok:
            if not nm.raw_config:
                asyncio.create_task(_bg_pull(nm_id, nas_id))




@router.post("/{nas_id}/pull-config")
async def trigger_pull(
    nas_id: int,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nm = await _get_nm(nas_id, db)
    asyncio.create_task(_bg_pull(nm.id, nas_id))
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.pull_config",
        target=str(nas_id),
    )
    return {"ok": True, "detail": "Config pull started in background"}


@router.get("/{nas_id}/config")
async def get_config(
    nas_id: int,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nm = await _get_nm(nas_id, db)
    return {
        "raw_config": nm.raw_config or "",
        "config_pulled_at": nm.config_pulled_at.isoformat() if nm.config_pulled_at else None,
        "config_pushed_at": nm.config_pushed_at.isoformat() if nm.config_pushed_at else None,
    }


async def _bg_pull(nm_id: int, nas_id: int, source: str = "manual") -> None:
    async with SessionLocal() as db:
        result = await db.execute(
            select(MrNasManager)
            .where(MrNasManager.id == nm_id)
            .options(selectinload(MrNasManager.nas))
        )
        nm = result.scalar_one_or_none()
        if not nm:
            return

        try:
            password = decrypt(nm.secret_enc, settings.secret_key)
        except Exception:
            logger.error("NAS Manager: could not decrypt credentials for nas_id=%s", nas_id)
            return

        raw, err = await pull_config(nm, password)
        if err:
            logger.warning("NAS Manager pull_config failed for nas_id=%s: %s", nas_id, err)
            nm.test_status = "failed"
            nm.test_error = err
        else:
            nm.raw_config = raw
            nm.config_pulled_at = datetime.now(timezone.utc)
            nm.test_status = "connected"
            nm.test_error = None
            if nm.history_enabled:
                await store_version(db, nm, raw, source=source)
                await apply_retention(db, nm)
        await db.commit()




@router.post("/{nas_id}/push-config")
async def push_config_endpoint(
    nas_id: int,
    body: dict,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    config_text: str = body.get("config", "")
    if not config_text.strip():
        raise HTTPException(422, "config is required")

    nm = await _get_nm(nas_id, db)
    password = _decrypt_or_raise(nm)
    lines = [ln for ln in config_text.splitlines() if ln.strip()]

    ok, err = await push_config(nm, password, lines)
    if not ok:
        raise HTTPException(500, f"Push failed: {err}")

    nm.raw_config = config_text
    nm.config_pushed_at = datetime.now(timezone.utc)
    if nm.history_enabled:
        await store_version(db, nm, config_text, source="push")
        await apply_retention(db, nm)
    await db.commit()
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.push_config",
        target=str(nas_id),
    )
    return {"ok": True}




@router.put("/{nas_id}/history-settings")
async def update_history_settings(
    nas_id: int,
    body: HistorySettingsIn,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> NasManagerOut:
    nm = await _get_nm(nas_id, db)
    nm.history_enabled = body.history_enabled
    nm.fetch_interval_hours = body.fetch_interval_hours
    nm.retention_days = body.retention_days if body.retention_days else None
    if nm.history_enabled:
        await apply_retention(db, nm)
    await db.commit()
    await db.refresh(nm)
    await db.refresh(nm, ["nas"])
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.history_settings",
        target=str(nas_id),
        detail={
            "history_enabled": body.history_enabled,
            "fetch_interval_hours": body.fetch_interval_hours,
            "retention_days": body.retention_days,
        },
    )
    return NasManagerOut.from_model(nm)


@router.get("/{nas_id}/config-versions")
async def list_config_versions(
    nas_id: int,
    limit: int = 100,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConfigVersionOut]:
    rows = (
        (
            await db.execute(
                select(MrNasConfigVersion)
                .where(MrNasConfigVersion.nas_id == nas_id)
                .order_by(MrNasConfigVersion.created_at.asc())
                .limit(min(limit, 500))
            )
        )
        .scalars()
        .all()
    )

    out: list[ConfigVersionOut] = []
    prev_config = ""
    for v in rows:
        added, removed = diff_stats(prev_config, v.config)
        out.append(
            ConfigVersionOut(
                id=int(v.id),
                created_at=v.created_at,
                source=v.source,
                byte_size=int(v.byte_size),
                line_count=int(v.line_count),
                sha256_short=v.sha256[:12],
                added=added,
                removed=removed,
            )
        )
        prev_config = v.config
    out.reverse()
    return out


@router.get("/{nas_id}/config-versions/{version_id}")
async def get_config_version(
    nas_id: int,
    version_id: int,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    v = (
        await db.execute(
            select(MrNasConfigVersion).where(
                MrNasConfigVersion.id == version_id,
                MrNasConfigVersion.nas_id == nas_id,
            )
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, "Config version not found")
    return {
        "id": int(v.id),
        "created_at": v.created_at.isoformat(),
        "source": v.source,
        "byte_size": int(v.byte_size),
        "line_count": int(v.line_count),
        "sha256": v.sha256,
        "config": v.config,
    }


@router.delete("/{nas_id}/config-versions/{version_id}", status_code=204)
async def delete_config_version(
    nas_id: int,
    version_id: int,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    v = (
        await db.execute(
            select(MrNasConfigVersion).where(
                MrNasConfigVersion.id == version_id,
                MrNasConfigVersion.nas_id == nas_id,
            )
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, "Config version not found")
    await db.delete(v)
    await db.commit()
    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.delete_version",
        target=str(nas_id),
        detail={"version_id": version_id},
    )


async def _resolve_snapshot(db: AsyncSession, nm: MrNasManager, ref: str) -> tuple[str, str]:
    if ref == "current":
        return str(nm.raw_config or ""), "current (live)"
    try:
        vid = int(ref)
    except ValueError:
        raise HTTPException(422, f"invalid version reference: {ref!r}")
    v = (
        await db.execute(
            select(MrNasConfigVersion).where(
                MrNasConfigVersion.id == vid,
                MrNasConfigVersion.nas_id == nm.nas_id,
            )
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, f"Config version {vid} not found")
    return str(v.config), f"v{vid} @ {v.created_at.isoformat()}"


@router.get("/{nas_id}/config-diff")
async def config_diff(
    nas_id: int,
    from_ref: str,
    to_ref: str,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nm = await _get_nm(nas_id, db)
    old_text, old_label = await _resolve_snapshot(db, nm, from_ref)
    new_text, new_label = await _resolve_snapshot(db, nm, to_ref)
    added, removed = diff_stats(old_text, new_text)
    return {
        "from_label": old_label,
        "to_label": new_label,
        "added": added,
        "removed": removed,
        "identical": added == 0 and removed == 0,
        "diff": unified_diff(old_text, new_text, old_label, new_label),
    }




@router.get("/{nas_id}/command")
async def command_stream(
    nas_id: int,
    command: str,
    user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    command = command.strip()
    if not command or len(command) > 500:
        raise HTTPException(422, "command must be 1–500 characters")

    nm = await _get_nm(nas_id, db)
    password = _decrypt_or_raise(nm)
    target_nas_id = int(nm.nas_id)
    actor = user.username

    async def _sse():
        chunks: list[str] = []
        had_error = False
        async for line in run_command_stream(nm, password, command):
            if line.startswith("ERROR:"):
                had_error = True
            chunks.append(line)
            yield f"data: {line}\n\n"
        yield "data: [DONE]\n\n"

        output = "".join(chunks).strip()
        try:
            async with SessionLocal() as ldb:
                ldb.add(
                    MrNasDispatchLog(
                        nas_id=target_nas_id,
                        command=command,
                        output=None if had_error else (output or None),
                        error=output if had_error else None,
                        status="error" if had_error else "ok",
                        executed_at=datetime.now(timezone.utc),
                        actor=actor,
                    )
                )
                await ldb.commit()
        except Exception:
            logger.exception(
                "NAS Manager: failed to record command log for nas_id=%s", target_nas_id
            )

    return StreamingResponse(_sse(), media_type="text/event-stream")




@router.post("/dispatch")
async def dispatch_command(
    body: DispatchRequest,
    current_user: AdminUser = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows = (
        (
            await db.execute(
                select(MrNasManager)
                .where(MrNasManager.nas_id.in_([int(i) for i in body.nas_ids]))
                .where(MrNasManager.enabled == True)  # noqa: E712
                .options(selectinload(MrNasManager.nas))
            )
        )
        .scalars()
        .all()
    )

    if not rows:
        raise HTTPException(404, "No enabled managed NAS devices found for the given IDs")

    await audit(
        db,
        user_id=current_user.id,
        username=current_user.username,
        action="nas_manager.dispatch",
        detail={"devices": len(rows), "command": body.command[:60]},
    )
    asyncio.create_task(
        _bg_dispatch(
            [int(r.id) for r in rows],
            body.command,
            current_user.username,
        )
    )

    return {"ok": True, "detail": f"Command dispatched to {len(rows)} device(s)"}


async def _bg_dispatch(nm_ids: list[int], command: str, actor: str) -> None:
    from monsterops.database import SessionLocal

    async def _one(nm_id: int) -> None:
        async with SessionLocal() as db:
            result = await db.execute(
                select(MrNasManager)
                .where(MrNasManager.id == nm_id)
                .options(selectinload(MrNasManager.nas))
            )
            nm = result.scalar_one_or_none()
            if not nm:
                return

            log = MrNasDispatchLog(
                nas_id=nm.nas_id,
                command=command,
                status="pending",
                actor=actor,
            )
            db.add(log)
            await db.commit()

            try:
                password = decrypt(nm.secret_enc, settings.secret_key)
                output, err = await run_command(nm, password, command)
                log.output = output
                log.error = err if err else None
                log.status = "ok" if not err else "error"
            except Exception as exc:
                log.status = "error"
                log.error = str(exc)
            finally:
                log.executed_at = datetime.now(timezone.utc)
                await db.commit()

    await asyncio.gather(*[_one(i) for i in nm_ids], return_exceptions=True)




@router.get("/{nas_id}/dispatch-log")
async def get_dispatch_log(
    nas_id: int,
    limit: int = 50,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (
        (
            await db.execute(
                select(MrNasDispatchLog)
                .where(MrNasDispatchLog.nas_id == nas_id)
                .order_by(MrNasDispatchLog.id.desc())
                .limit(min(limit, 200))
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "command": r.command,
            "output": r.output,
            "status": r.status,
            "error": r.error,
            "executed_at": r.executed_at.isoformat() if r.executed_at else None,
            "actor": r.actor,
        }
        for r in rows
    ]
