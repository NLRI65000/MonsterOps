from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import require_roles

from .models import Integration
from .schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate, TestResult

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

_VALID_TYPES = frozenset({"graylog", "zabbix"})


def _build_graylog(cfg: dict[str, Any]):
    from .graylog_client import GraylogClient

    return GraylogClient(
        base_url=cfg.get("base_url", ""),
        username=cfg.get("username", ""),
        password=cfg.get("password", ""),
        stream_id=cfg.get("stream_id") or None,
        verify_ssl=bool(cfg.get("verify_ssl", False)),
        timeout=int(cfg.get("timeout", 10)),
        nas_ip_field=str(cfg.get("nas_ip_field") or "source"),
        username_field=str(cfg.get("username_field") or ""),
    )


def _build_zabbix(cfg: dict[str, Any]):
    from .zabbix_client import ZabbixClient

    return ZabbixClient(
        base_url=cfg.get("base_url", ""),
        username=cfg.get("username", ""),
        password=cfg.get("password", ""),
        verify_ssl=bool(cfg.get("verify_ssl", False)),
        timeout=int(cfg.get("timeout", 10)),
    )


async def _first_enabled(db: AsyncSession, itype: str) -> Integration:
    row = await db.scalar(
        select(Integration).where(
            Integration.type == itype,
            Integration.enabled == True,  # noqa: E712
        )
    )
    if not row:
        raise HTTPException(404, f"No enabled {itype} integration configured")
    return row



@router.get("/status", tags=["integrations"])
async def integration_status(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    rows = (await db.execute(select(Integration))).scalars().all()
    return [
        {"id": r.id, "name": str(r.name), "type": str(r.type), "enabled": bool(r.enabled)}
        for r in rows
    ]



@router.get("/graylog/session-logs", tags=["integrations"])
async def graylog_session_logs(
    since: str,
    nas_ip: str | None = None,
    nas_identifier: str | None = None,
    username: str | None = None,
    until: str | None = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    if not nas_ip and not nas_identifier:
        raise HTTPException(400, "Either 'nas_ip' or 'nas_identifier' is required")

    integration = await _first_enabled(db, "graylog")
    cfg: dict[str, Any] = integration.config or {}  # type: ignore[assignment]
    client = _build_graylog(cfg)

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Invalid 'since' datetime: {since!r}")

    until_dt: datetime | None = None
    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, f"Invalid 'until' datetime: {until!r}")

    try:
        logs = await client.search_logs(nas_ip, since_dt, until_dt, username, limit, nas_identifier)
        return {
            "logs": logs,
            "count": len(logs),
            "nas_ip": nas_ip or "",
            "nas_identifier": nas_identifier or "",
        }
    except Exception as exc:
        raise HTTPException(502, f"Graylog error: {exc}")



@router.get("/zabbix/host-problems", tags=["integrations"])
async def zabbix_host_problems(
    nas_ip: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    integration = await _first_enabled(db, "zabbix")
    cfg: dict[str, Any] = integration.config or {}  # type: ignore[assignment]
    client = _build_zabbix(cfg)
    try:
        problems = await client.get_host_problems(nas_ip)
        return {"problems": problems, "count": len(problems), "nas_ip": nas_ip}
    except Exception as exc:
        raise HTTPException(502, f"Zabbix error: {exc}")


@router.get("/zabbix/problems-summary", tags=["integrations"])
async def zabbix_problems_summary(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    row = await db.scalar(
        select(Integration).where(
            Integration.type == "zabbix",
            Integration.enabled == True,  # noqa: E712
        )
    )
    if not row:
        return {"total": 0, "by_severity": {}, "configured": False}
    cfg: dict[str, Any] = row.config or {}  # type: ignore[assignment]
    client = _build_zabbix(cfg)
    try:
        summary = await client.get_problems_summary()
        summary["configured"] = True
        return summary
    except Exception as exc:
        return {"total": 0, "by_severity": {}, "configured": True, "error": str(exc)}



@router.get("", response_model=list[IntegrationOut])
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    rows = (await db.execute(select(Integration).order_by(Integration.id))).scalars().all()
    return rows


@router.post("", response_model=IntegrationOut, status_code=201)
async def create_integration(
    body: IntegrationCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    if body.type not in _VALID_TYPES:
        raise HTTPException(400, f"type must be one of: {', '.join(sorted(_VALID_TYPES))}")
    if await db.scalar(select(Integration).where(Integration.name == body.name)):
        raise HTTPException(409, "Integration name already exists")
    obj = Integration(name=body.name, type=body.type, config=body.config, enabled=body.enabled)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/{integration_id}", response_model=IntegrationOut)
async def get_integration(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    obj = await db.get(Integration, integration_id)
    if not obj:
        raise HTTPException(404, "Integration not found")
    return obj


@router.put("/{integration_id}", response_model=IntegrationOut)
async def update_integration(
    integration_id: int,
    body: IntegrationUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    obj = await db.get(Integration, integration_id)
    if not obj:
        raise HTTPException(404, "Integration not found")
    if body.type is not None and body.type not in _VALID_TYPES:
        raise HTTPException(400, f"type must be one of: {', '.join(sorted(_VALID_TYPES))}")
    if body.name is not None:
        obj.name = body.name  # type: ignore[assignment]
    if body.type is not None:
        obj.type = body.type  # type: ignore[assignment]
    if body.config is not None:
        obj.config = body.config  # type: ignore[assignment]
    if body.enabled is not None:
        obj.enabled = body.enabled  # type: ignore[assignment]
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{integration_id}", status_code=204)
async def delete_integration(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    obj = await db.get(Integration, integration_id)
    if not obj:
        raise HTTPException(404, "Integration not found")
    await db.delete(obj)
    await db.commit()


@router.post("/{integration_id}/test", response_model=TestResult)
async def test_integration(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    obj = await db.get(Integration, integration_id)
    if not obj:
        raise HTTPException(404, "Integration not found")
    cfg: dict[str, Any] = obj.config or {}  # type: ignore[assignment]
    itype = str(obj.type)
    try:
        if itype == "graylog":
            detail = await _build_graylog(cfg).test_connection()
        elif itype == "zabbix":
            detail = await _build_zabbix(cfg).test_connection()
        else:
            return TestResult(ok=False, message="Unknown integration type")
        return TestResult(ok=True, message="Connection successful", detail=detail)
    except Exception as exc:
        return TestResult(ok=False, message=str(exc))
