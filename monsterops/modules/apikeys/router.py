from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import require_roles

from .models import ApiKey
from .schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut

router = APIRouter(prefix="/api/apikeys", tags=["apikeys"])

_VALID_SCOPES = frozenset({
    "sessions.read",
    "users.read",
    "auth_logs.read",
    "groups.read",
    "nas.read",
    "users.write",
    "groups.write",
    "nas.write",
    "coa.send",
})


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _generate_key() -> tuple[str, str]:
    random_part = os.urandom(24).hex()
    key = f"mr_{random_part}"
    prefix = key[:11]
    return key, prefix



async def require_api_key(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    raw = request.headers.get("X-API-Key") or request.query_params.get("api_key")
    if not raw:
        raise HTTPException(401, "API key required (X-API-Key header)")
    key_hash = _hash_key(raw)
    row = await db.scalar(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.revoked.is_(False))
    )
    if not row:
        raise HTTPException(401, "Invalid or revoked API key")
    if row.expires_at and row.expires_at < datetime.now(tz=timezone.utc):
        raise HTTPException(401, "API key expired")
    row.last_used_at = datetime.now(tz=timezone.utc)
    await db.commit()
    return row


def _check_scope(key: ApiKey, scope: str) -> None:
    if scope not in (key.scopes or []):
        raise HTTPException(403, f"API key missing required scope: {scope}")



@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    rows = (await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))).scalars().all()
    return rows


@router.post("", response_model=ApiKeyCreated, status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("superadmin", "admin")),
):
    bad = [s for s in body.scopes if s not in _VALID_SCOPES]
    if bad:
        raise HTTPException(400, f"Invalid scopes: {', '.join(bad)}. Valid: {', '.join(sorted(_VALID_SCOPES))}")

    plaintext, prefix = _generate_key()
    row = ApiKey(
        name=body.name,
        key_prefix=prefix,
        key_hash=_hash_key(plaintext),
        scopes=body.scopes,
        created_by=current_user.id,
        expires_at=body.expires_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ApiKeyCreated(
        id=row.id, name=row.name, key_prefix=row.key_prefix,
        scopes=row.scopes or [], created_by=row.created_by,
        last_used_at=row.last_used_at, expires_at=row.expires_at,
        revoked=bool(row.revoked), created_at=row.created_at,
        plaintext_key=plaintext,
    )


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    row = await db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(404, "API key not found")
    row.revoked = True  # type: ignore[assignment]
    await db.commit()



_ext = APIRouter(prefix="/api/ext", tags=["external-api"])


@_ext.get("/sessions")
async def ext_sessions(
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "sessions.read")
    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.accounting.schemas import RadacctOut
    q = await db.execute(
        select(Radacct)
        .where(Radacct.acctstoptime.is_(None))
        .order_by(Radacct.acctstarttime.desc())
        .limit(500)
    )
    rows = q.scalars().all()
    result = []
    for r in rows:
        obj = RadacctOut.model_validate(r)
        obj.active = True
        result.append(obj.model_dump(mode="json"))
    return {"sessions": result, "count": len(result)}


@_ext.get("/users/{username}")
async def ext_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "users.read")
    from monsterops.modules.users.models import Radcheck, Radusergroup
    checks = (await db.execute(
        select(Radcheck).where(Radcheck.username == username)
    )).scalars().all()
    groups = (await db.execute(
        select(Radusergroup).where(Radusergroup.username == username)
    )).scalars().all()
    return {
        "username": username,
        "attributes": [{"attribute": c.attribute, "op": c.op, "value": c.value} for c in checks],
        "groups": [g.groupname for g in groups],
    }


@_ext.post("/coa/disconnect")
async def ext_coa_disconnect(
    body: dict[str, str],
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "coa.send")
    acctuniqueid = body.get("acctuniqueid") or ""
    if not acctuniqueid:
        raise HTTPException(400, "acctuniqueid is required")
    from monsterops.modules.accounting.router import _resolve_session_and_nas
    from monsterops.modules.accounting.coa import send_disconnect
    session, nas = await _resolve_session_and_nas(acctuniqueid, db)
    nas_ip = str(session.nasipaddress).split("/")[0]
    result = await send_disconnect(
        nas_ip=nas_ip, secret=nas.secret,
        username=session.username or "",
        session_id=session.acctsessionid,
        calling_station=session.callingstationid or None,
    )
    return result
