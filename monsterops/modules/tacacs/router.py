
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.modules.auth.utils import audit, get_current_user, hash_password, require_roles
from monsterops.modules.nas.models import Nas
from monsterops.modules.nas_manager.crypto import encrypt
from monsterops.modules.realms.models import MrIdentitySource
from monsterops.modules.tacacs.models import (
    MrTacacsAcctRecord,
    MrTacacsClient,
    MrTacacsCommandRule,
    MrTacacsUser,
)
from monsterops.modules.tacacs.schemas import (
    AaaSnippet,
    AaaVendor,
    IdentitySourceRef,
    TacacsAcctRecordOut,
    TacacsClientCreate,
    TacacsClientOut,
    TacacsClientUpdate,
    TacacsRuleCreate,
    TacacsRuleOut,
    TacacsRuleUpdate,
    TacacsStatus,
    TacacsUserCreate,
    TacacsUserOut,
    TacacsUserUpdate,
)
from monsterops.modules.tacacs.snippets import VENDORS, build_aaa_snippet

router = APIRouter(prefix="/api/tacacs", tags=["tacacs"])




@router.get("/status", response_model=TacacsStatus)
async def get_status(_user=Depends(get_current_user)) -> TacacsStatus:
    return TacacsStatus(
        enabled=settings.tacacs_enabled,
        host=settings.tacacs_host,
        port=settings.tacacs_port,
    )


@router.get("/identity-sources", response_model=list[IdentitySourceRef])
async def list_identity_sources(
    db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    rows = (
        await db.execute(select(MrIdentitySource).order_by(MrIdentitySource.name))
    ).scalars().all()
    return [IdentitySourceRef.model_validate(s) for s in rows]




@router.get("/aaa-vendors", response_model=list[AaaVendor])
async def aaa_vendors(_user=Depends(get_current_user)) -> list[AaaVendor]:
    return [AaaVendor(id=vid, label=label) for vid, label in VENDORS.items()]


@router.get("/aaa-snippet", response_model=AaaSnippet)
async def aaa_snippet(
    vendor: str = Query("cisco_ios"),
    server: str = Query("<monsterops-server-ip>", max_length=128),
    _user=Depends(get_current_user),
) -> AaaSnippet:
    if vendor not in VENDORS:
        raise HTTPException(400, "unknown vendor")
    return AaaSnippet(
        vendor=vendor,
        label=VENDORS[vendor],
        server=server,
        port=settings.tacacs_port,
        text=build_aaa_snippet(vendor, server, settings.tacacs_port),
    )




async def _validate_nas(db: AsyncSession, nas_id: int | None) -> None:
    if nas_id is not None and await db.get(Nas, nas_id) is None:
        raise HTTPException(400, f"NAS {nas_id} does not exist")


@router.get("/clients", response_model=list[TacacsClientOut])
async def list_clients(
    nas_id: int | None = Query(None, description="only clients linked to this NAS"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    stmt = select(MrTacacsClient).order_by(MrTacacsClient.name)
    if nas_id is not None:
        stmt = stmt.where(MrTacacsClient.nas_id == nas_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [TacacsClientOut.model_validate(c) for c in rows]


@router.post("/clients", response_model=TacacsClientOut, status_code=201)
async def create_client(
    body: TacacsClientCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(
        select(func.count()).select_from(MrTacacsClient).where(MrTacacsClient.name == body.name)
    )
    if dup:
        raise HTTPException(409, f"Client '{body.name}' already exists")
    await _validate_nas(db, body.nas_id)
    data = body.model_dump()
    secret = data.pop("secret")
    client = MrTacacsClient(**data, secret_enc=encrypt(secret, settings.secret_key))
    db.add(client)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.client_create",
        target=body.name,
        request=request,
    )
    await db.refresh(client)
    return TacacsClientOut.model_validate(client)


@router.put("/clients/{client_id}", response_model=TacacsClientOut)
async def update_client(
    client_id: int,
    body: TacacsClientUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    client = await db.get(MrTacacsClient, client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    dup = await db.scalar(
        select(func.count())
        .select_from(MrTacacsClient)
        .where(MrTacacsClient.name == body.name, MrTacacsClient.id != client_id)
    )
    if dup:
        raise HTTPException(409, f"Client '{body.name}' already exists")
    await _validate_nas(db, body.nas_id)
    data = body.model_dump()
    secret = data.pop("secret")
    if secret:
        client.secret_enc = encrypt(secret, settings.secret_key)
    for k, v in data.items():
        setattr(client, k, v)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.client_update",
        target=client.name,
        request=request,
    )
    await db.refresh(client)
    return TacacsClientOut.model_validate(client)


@router.delete("/clients/{client_id}", status_code=204)
async def delete_client(
    client_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    client = await db.get(MrTacacsClient, client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    name = client.name
    await db.delete(client)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.client_delete",
        target=name,
        request=request,
    )




def _user_out(user: MrTacacsUser) -> TacacsUserOut:
    out = TacacsUserOut.model_validate(user)
    out.has_password = bool(user.password_hash)
    return out


async def _validate_identity_source(db: AsyncSession, source_id: int | None) -> None:
    if source_id is not None and await db.get(MrIdentitySource, source_id) is None:
        raise HTTPException(400, f"Identity source {source_id} does not exist")


@router.get("/users", response_model=list[TacacsUserOut])
async def list_users(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    rows = (await db.execute(select(MrTacacsUser).order_by(MrTacacsUser.username))).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("/users", response_model=TacacsUserOut, status_code=201)
async def create_user(
    body: TacacsUserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(
        select(func.count()).select_from(MrTacacsUser).where(MrTacacsUser.username == body.username)
    )
    if dup:
        raise HTTPException(409, f"Account '{body.username}' already exists")
    await _validate_identity_source(db, body.identity_source_id)
    data = body.model_dump()
    password = data.pop("password")
    user = MrTacacsUser(**data, password_hash=hash_password(password) if password else None)
    db.add(user)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.user_create",
        target=body.username,
        request=request,
    )
    await db.refresh(user)
    return _user_out(user)


@router.put("/users/{user_id}", response_model=TacacsUserOut)
async def update_user(
    user_id: int,
    body: TacacsUserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    user = await db.get(MrTacacsUser, user_id)
    if not user:
        raise HTTPException(404, "Account not found")
    dup = await db.scalar(
        select(func.count())
        .select_from(MrTacacsUser)
        .where(MrTacacsUser.username == body.username, MrTacacsUser.id != user_id)
    )
    if dup:
        raise HTTPException(409, f"Account '{body.username}' already exists")
    await _validate_identity_source(db, body.identity_source_id)
    data = body.model_dump()
    password = data.pop("password")
    if password:
        user.password_hash = hash_password(password)
    for k, v in data.items():
        setattr(user, k, v)
    if user.auth_method == "local_password" and not user.password_hash:
        raise HTTPException(400, "a local_password account needs a password")
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.user_update",
        target=user.username,
        request=request,
    )
    await db.refresh(user)
    return _user_out(user)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    user = await db.get(MrTacacsUser, user_id)
    if not user:
        raise HTTPException(404, "Account not found")
    username = user.username
    await db.delete(user)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.user_delete",
        target=username,
        request=request,
    )




async def _get_user_or_404(db: AsyncSession, user_id: int) -> MrTacacsUser:
    user = await db.get(MrTacacsUser, user_id)
    if not user:
        raise HTTPException(404, "Account not found")
    return user


@router.get("/users/{user_id}/rules", response_model=list[TacacsRuleOut])
async def list_rules(
    user_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    await _get_user_or_404(db, user_id)
    rows = (
        await db.execute(
            select(MrTacacsCommandRule)
            .where(MrTacacsCommandRule.user_id == user_id)
            .order_by(MrTacacsCommandRule.sort_order, MrTacacsCommandRule.id)
        )
    ).scalars().all()
    return [TacacsRuleOut.model_validate(r) for r in rows]


@router.post("/users/{user_id}/rules", response_model=TacacsRuleOut, status_code=201)
async def create_rule(
    user_id: int,
    body: TacacsRuleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    user = await _get_user_or_404(db, user_id)
    rule = MrTacacsCommandRule(user_id=user_id, **body.model_dump())
    db.add(rule)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.rule_create",
        target=f"{user.username}:{body.action} {body.command}",
        request=request,
    )
    await db.refresh(rule)
    return TacacsRuleOut.model_validate(rule)


@router.put("/rules/{rule_id}", response_model=TacacsRuleOut)
async def update_rule(
    rule_id: int,
    body: TacacsRuleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    rule = await db.get(MrTacacsCommandRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.rule_update",
        target=str(rule_id),
        request=request,
    )
    await db.refresh(rule)
    return TacacsRuleOut.model_validate(rule)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    rule = await db.get(MrTacacsCommandRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    await db.delete(rule)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="tacacs.rule_delete",
        target=str(rule_id),
        request=request,
    )




@router.get("/accounting", response_model=list[TacacsAcctRecordOut])
async def list_accounting(
    username: str | None = Query(None),
    record_type: str | None = Query(None),
    client_id: int | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    stmt = select(MrTacacsAcctRecord)
    if username:
        stmt = stmt.where(MrTacacsAcctRecord.username == username)
    if record_type:
        stmt = stmt.where(MrTacacsAcctRecord.record_type == record_type)
    if client_id is not None:
        stmt = stmt.where(MrTacacsAcctRecord.client_id == client_id)
    stmt = stmt.order_by(MrTacacsAcctRecord.created_at.desc(), MrTacacsAcctRecord.id.desc())
    stmt = stmt.limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return [TacacsAcctRecordOut.model_validate(r) for r in rows]
