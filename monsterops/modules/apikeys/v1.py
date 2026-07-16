
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.radius_reload import restart_freeradius

from .models import ApiKey
from .router import _check_scope, require_api_key

router = APIRouter(prefix="/api/v1", tags=["v1"])

_PWD_TYPES = frozenset(
    {
        "Cleartext-Password",
        "MD5-Password",
        "NT-Password",
        "SHA-Password",
        "Crypt-Password",
    }
)
_DISABLED_ATTR = "Auth-Type"
_DISABLED_VALUE = "Reject"




class _Page(BaseModel):
    total: int
    page: int
    size: int


class V1User(BaseModel):
    username: str
    enabled: bool
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None


class V1UserList(_Page):
    items: list[V1User]


class V1UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)
    password_type: str = "Cleartext-Password"
    enabled: bool = True
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None


class V1UserUpdate(BaseModel):
    password: str | None = None
    password_type: str | None = None
    enabled: bool | None = None
    expiration: str | None = None
    simultaneous_use: int | None = None
    groups: list[str] | None = None


class V1GroupSummary(BaseModel):
    name: str
    member_count: int = 0


class V1GroupList(_Page):
    items: list[V1GroupSummary]


class V1GroupDetail(BaseModel):
    name: str
    check_attrs: list[dict[str, str]] = []
    reply_attrs: list[dict[str, str]] = []
    members: list[str] = []


class V1GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class V1GroupMemberAdd(BaseModel):
    username: str
    priority: int = 1


class V1NasSummary(BaseModel):
    id: int
    nasname: str
    shortname: str | None = None
    type: str | None = None
    description: str | None = None
    model_config = {"from_attributes": True}


class V1NasList(_Page):
    items: list[V1NasSummary]


class V1NasCreate(BaseModel):
    nasname: str = Field(..., min_length=1, max_length=128)
    shortname: str | None = None
    type: str = "other"
    ports: int | None = None
    secret: str = Field(..., min_length=1)
    server: str | None = None
    community: str | None = None
    description: str | None = None


class V1NasUpdate(BaseModel):
    nasname: str | None = None
    shortname: str | None = None
    type: str | None = None
    ports: int | None = None
    secret: str | None = None
    server: str | None = None
    community: str | None = None
    description: str | None = None




async def _user_or_404(username: str, db: AsyncSession) -> None:
    from monsterops.modules.users.models import Radcheck, Radusergroup

    for table in (Radcheck, Radusergroup):
        if await db.scalar(
            select(func.count()).select_from(table).where(table.username == username)
        ):
            return
    raise HTTPException(404, f"User '{username}' not found")


async def _build_user(username: str, db: AsyncSession) -> V1User:
    from monsterops.modules.users.models import Radcheck, Radusergroup

    checks = (
        (await db.execute(select(Radcheck).where(Radcheck.username == username))).scalars().all()
    )
    groups = (
        (
            await db.execute(
                select(Radusergroup)
                .where(Radusergroup.username == username)
                .order_by(Radusergroup.priority)
            )
        )
        .scalars()
        .all()
    )
    enabled = not any(c.attribute == _DISABLED_ATTR and c.value == _DISABLED_VALUE for c in checks)
    expiration = next((c.value for c in checks if c.attribute == "Expiration"), None)
    sim_use: int | None = None
    for c in checks:
        if c.attribute == "Simultaneous-Use":
            try:
                sim_use = int(c.value)
            except ValueError:
                pass
    return V1User(
        username=username,
        enabled=enabled,
        groups=[str(g.groupname) for g in groups],
        expiration=expiration,
        simultaneous_use=sim_use,
    )




@router.get("/users", response_model=V1UserList)
async def v1_list_users(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "users.read")
    from monsterops.modules.users.models import Radcheck, Radusergroup

    sub = union(
        select(Radcheck.username.label("username")).distinct(),
        select(Radusergroup.username.label("username")).distinct(),
    ).subquery()
    base = select(sub.c.username)
    if search:
        base = base.where(sub.c.username.ilike(f"%{search}%"))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(base.order_by(sub.c.username).limit(size).offset((page - 1) * size))
    ).all()
    items = [await _build_user(r[0], db) for r in rows]
    return V1UserList(total=total, page=page, size=size, items=items)


@router.get("/users/{username}", response_model=V1User)
async def v1_get_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "users.read")
    await _user_or_404(username, db)
    return await _build_user(username, db)




@router.post("/users", response_model=V1User, status_code=201)
async def v1_create_user(
    body: V1UserCreate,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "users.write")
    from monsterops.modules.users.models import Radcheck, Radusergroup

    if body.password_type not in _PWD_TYPES:
        raise HTTPException(400, f"Invalid password_type. Valid: {', '.join(sorted(_PWD_TYPES))}")
    if await db.scalar(
        select(func.count()).select_from(Radcheck).where(Radcheck.username == body.username)
    ):
        raise HTTPException(409, f"User '{body.username}' already exists")
    db.add(
        Radcheck(username=body.username, attribute=body.password_type, op=":=", value=body.password)
    )
    if not body.enabled:
        db.add(
            Radcheck(
                username=body.username, attribute=_DISABLED_ATTR, op=":=", value=_DISABLED_VALUE
            )
        )
    if body.expiration:
        db.add(
            Radcheck(username=body.username, attribute="Expiration", op=":=", value=body.expiration)
        )
    if body.simultaneous_use:
        db.add(
            Radcheck(
                username=body.username,
                attribute="Simultaneous-Use",
                op=":=",
                value=str(body.simultaneous_use),
            )
        )
    for i, g in enumerate(body.groups):
        db.add(Radusergroup(username=body.username, groupname=g, priority=i + 1))
    await db.commit()
    return await _build_user(body.username, db)


@router.put("/users/{username}", response_model=V1User)
async def v1_update_user(
    username: str,
    body: V1UserUpdate,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "users.write")
    from monsterops.modules.users.models import Radcheck, Radusergroup

    await _user_or_404(username, db)

    if body.password is not None:
        pwd_type = body.password_type or "Cleartext-Password"
        if pwd_type not in _PWD_TYPES:
            raise HTTPException(
                400, f"Invalid password_type. Valid: {', '.join(sorted(_PWD_TYPES))}"
            )
        for attr in _PWD_TYPES:
            await db.execute(
                delete(Radcheck).where(Radcheck.username == username, Radcheck.attribute == attr)
            )
        db.add(Radcheck(username=username, attribute=pwd_type, op=":=", value=body.password))

    if body.enabled is not None:
        await db.execute(
            delete(Radcheck).where(
                Radcheck.username == username, Radcheck.attribute == _DISABLED_ATTR
            )
        )
        if not body.enabled:
            db.add(
                Radcheck(
                    username=username, attribute=_DISABLED_ATTR, op=":=", value=_DISABLED_VALUE
                )
            )

    if body.expiration is not None:
        await db.execute(
            delete(Radcheck).where(
                Radcheck.username == username, Radcheck.attribute == "Expiration"
            )
        )
        if body.expiration:
            db.add(
                Radcheck(username=username, attribute="Expiration", op=":=", value=body.expiration)
            )

    if body.simultaneous_use is not None:
        await db.execute(
            delete(Radcheck).where(
                Radcheck.username == username, Radcheck.attribute == "Simultaneous-Use"
            )
        )
        if body.simultaneous_use > 0:
            db.add(
                Radcheck(
                    username=username,
                    attribute="Simultaneous-Use",
                    op=":=",
                    value=str(body.simultaneous_use),
                )
            )

    if body.groups is not None:
        await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
        for i, g in enumerate(body.groups):
            db.add(Radusergroup(username=username, groupname=g, priority=i + 1))

    await db.commit()
    return await _build_user(username, db)


@router.delete("/users/{username}", status_code=204)
async def v1_delete_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> None:
    _check_scope(key, "users.write")
    from monsterops.modules.users.models import Radcheck, Radreply, Radusergroup

    await _user_or_404(username, db)
    await db.execute(delete(Radcheck).where(Radcheck.username == username))
    await db.execute(delete(Radreply).where(Radreply.username == username))
    await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
    await db.commit()




@router.get("/users/{username}/sessions")
async def v1_user_sessions(
    username: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "sessions.read")
    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.accounting.schemas import RadacctOut

    rows = (
        (
            await db.execute(
                select(Radacct)
                .where(Radacct.username == username)
                .order_by(Radacct.acctstarttime.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    result = [RadacctOut.model_validate(r).model_dump(mode="json") for r in rows]
    return {"sessions": result, "count": len(result)}




@router.get("/groups", response_model=V1GroupList)
async def v1_list_groups(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "groups.read")
    from monsterops.modules.groups.models import Radgroupcheck
    from monsterops.modules.users.models import Radusergroup

    sub = union(
        select(Radgroupcheck.groupname.label("name")).distinct(),
        select(Radusergroup.groupname.label("name")).distinct(),
    ).subquery()
    base = select(sub.c.name)
    if search:
        base = base.where(sub.c.name.ilike(f"%{search}%"))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (await db.execute(base.order_by(sub.c.name).limit(size).offset((page - 1) * size))).all()
    items = []
    for (name,) in rows:
        cnt = (
            await db.scalar(
                select(func.count()).select_from(Radusergroup).where(Radusergroup.groupname == name)
            )
            or 0
        )
        items.append(V1GroupSummary(name=name, member_count=cnt))
    return V1GroupList(total=total, page=page, size=size, items=items)


@router.get("/groups/{groupname}", response_model=V1GroupDetail)
async def v1_get_group(
    groupname: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "groups.read")
    from monsterops.modules.groups.models import Radgroupcheck, Radgroupreply
    from monsterops.modules.users.models import Radusergroup

    checks = (
        (await db.execute(select(Radgroupcheck).where(Radgroupcheck.groupname == groupname)))
        .scalars()
        .all()
    )
    replies = (
        (await db.execute(select(Radgroupreply).where(Radgroupreply.groupname == groupname)))
        .scalars()
        .all()
    )
    members = (
        (
            await db.execute(
                select(Radusergroup.username)
                .where(Radusergroup.groupname == groupname)
                .order_by(Radusergroup.username)
            )
        )
        .scalars()
        .all()
    )
    if not checks and not replies and not members:
        raise HTTPException(404, f"Group '{groupname}' not found")
    return V1GroupDetail(
        name=groupname,
        check_attrs=[{"attribute": c.attribute, "op": c.op, "value": c.value} for c in checks],
        reply_attrs=[{"attribute": r.attribute, "op": r.op, "value": r.value} for r in replies],
        members=list(members),
    )




@router.post("/groups", response_model=V1GroupSummary, status_code=201)
async def v1_create_group(
    body: V1GroupCreate,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "groups.write")
    from monsterops.modules.groups.models import Radgroupcheck
    from monsterops.modules.users.models import Radusergroup

    for table in (Radgroupcheck, Radusergroup):
        if await db.scalar(
            select(func.count()).select_from(table).where(table.groupname == body.name)
        ):
            raise HTTPException(409, f"Group '{body.name}' already exists")
    db.add(Radgroupcheck(groupname=body.name, attribute="Fall-Through", op=":=", value="No"))
    await db.commit()
    return V1GroupSummary(name=body.name, member_count=0)


@router.delete("/groups/{groupname}", status_code=204)
async def v1_delete_group(
    groupname: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> None:
    _check_scope(key, "groups.write")
    from monsterops.modules.groups.models import GroupAccessType, Radgroupcheck, Radgroupreply
    from monsterops.modules.users.models import Radusergroup

    await db.execute(delete(Radgroupcheck).where(Radgroupcheck.groupname == groupname))
    await db.execute(delete(Radgroupreply).where(Radgroupreply.groupname == groupname))
    await db.execute(delete(Radusergroup).where(Radusergroup.groupname == groupname))
    await db.execute(delete(GroupAccessType).where(GroupAccessType.groupname == groupname))
    await db.commit()


@router.post("/groups/{groupname}/members", status_code=201)
async def v1_add_group_member(
    groupname: str,
    body: V1GroupMemberAdd,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "groups.write")
    from monsterops.modules.users.models import Radusergroup

    if await db.scalar(
        select(func.count())
        .select_from(Radusergroup)
        .where(Radusergroup.groupname == groupname, Radusergroup.username == body.username)
    ):
        raise HTTPException(409, f"'{body.username}' is already a member of '{groupname}'")
    db.add(Radusergroup(username=body.username, groupname=groupname, priority=body.priority))
    await db.commit()
    return {"ok": True}


@router.delete("/groups/{groupname}/members/{username}", status_code=204)
async def v1_remove_group_member(
    groupname: str,
    username: str,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> None:
    _check_scope(key, "groups.write")
    from monsterops.modules.users.models import Radusergroup

    result = await db.execute(
        delete(Radusergroup).where(
            Radusergroup.groupname == groupname,
            Radusergroup.username == username,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(404, f"'{username}' is not a member of '{groupname}'")
    await db.commit()




@router.get("/nas", response_model=V1NasList)
async def v1_list_nas(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "nas.read")
    from monsterops.modules.nas.models import Nas

    base = select(Nas)
    if search:
        term = f"%{search}%"
        base = base.where(Nas.nasname.ilike(term) | Nas.shortname.ilike(term))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        (
            await db.execute(
                base.order_by(Nas.shortname, Nas.nasname).limit(size).offset((page - 1) * size)
            )
        )
        .scalars()
        .all()
    )
    return V1NasList(
        total=total, page=page, size=size, items=[V1NasSummary.model_validate(r) for r in rows]
    )


@router.get("/nas/{nas_id}", response_model=V1NasSummary)
async def v1_get_nas(
    nas_id: int,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "nas.read")
    from monsterops.modules.nas.models import Nas

    row = await db.scalar(select(Nas).where(Nas.id == nas_id))
    if not row:
        raise HTTPException(404, "NAS not found")
    return V1NasSummary.model_validate(row)




@router.post("/nas", response_model=V1NasSummary, status_code=201)
async def v1_create_nas(
    body: V1NasCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "nas.write")
    from monsterops.modules.nas.models import Nas

    if await db.scalar(select(func.count()).select_from(Nas).where(Nas.nasname == body.nasname)):
        raise HTTPException(409, f"NAS '{body.nasname}' already exists")
    row = Nas(
        nasname=body.nasname,
        shortname=body.shortname,
        type=body.type,
        ports=body.ports,
        secret=body.secret,
        server=body.server,
        community=body.community,
        description=body.description,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    background_tasks.add_task(restart_freeradius)
    return V1NasSummary.model_validate(row)


@router.put("/nas/{nas_id}", response_model=V1NasSummary)
async def v1_update_nas(
    nas_id: int,
    body: V1NasUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "nas.write")
    from monsterops.modules.nas.models import Nas

    row = await db.scalar(select(Nas).where(Nas.id == nas_id))
    if not row:
        raise HTTPException(404, "NAS not found")
    changed = False
    if body.nasname is not None and body.nasname != row.nasname:
        if await db.scalar(
            select(func.count())
            .select_from(Nas)
            .where(Nas.nasname == body.nasname, Nas.id != nas_id)
        ):
            raise HTTPException(409, f"NAS '{body.nasname}' already exists")
        row.nasname = body.nasname
        changed = True
    for field in ("shortname", "type", "ports", "secret", "server", "community", "description"):
        val = getattr(body, field)
        if val is not None:
            setattr(row, field, val)
            changed = True
    if changed:
        await db.commit()
        await db.refresh(row)
        background_tasks.add_task(restart_freeradius)
    return V1NasSummary.model_validate(row)


@router.delete("/nas/{nas_id}", status_code=204)
async def v1_delete_nas(
    nas_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> None:
    _check_scope(key, "nas.write")
    from monsterops.modules.nas.models import Nas

    row = await db.scalar(select(Nas).where(Nas.id == nas_id))
    if not row:
        raise HTTPException(404, "NAS not found")
    await db.delete(row)
    await db.commit()
    background_tasks.add_task(restart_freeradius)




@router.get("/sessions")
async def v1_sessions(
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "sessions.read")
    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.accounting.schemas import RadacctOut

    rows = (
        (
            await db.execute(
                select(Radacct)
                .where(Radacct.acctstoptime.is_(None))
                .order_by(Radacct.acctstarttime.desc())
                .limit(500)
            )
        )
        .scalars()
        .all()
    )
    result = []
    for r in rows:
        obj = RadacctOut.model_validate(r)
        obj.active = True
        result.append(obj.model_dump(mode="json"))
    return {"sessions": result, "count": len(result)}




@router.get("/auth-logs")
async def v1_auth_logs(
    username: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "auth_logs.read")
    from monsterops.modules.auth_logs.models import Radpostauth

    q = select(Radpostauth).order_by(Radpostauth.authdate.desc()).limit(limit)
    if username:
        q = q.where(Radpostauth.username == username)
    rows = (await db.execute(q)).scalars().all()
    return {
        "auth_logs": [
            {
                "id": r.id,
                "username": r.username,
                "reply": r.reply,
                "authdate": r.authdate.isoformat() if r.authdate else None,
                "nasipaddress": str(r.nasipaddress) if r.nasipaddress else None,
            }
            for r in rows
        ],
        "count": len(rows),
    }




@router.post("/coa/disconnect")
async def v1_coa_disconnect(
    body: dict[str, str],
    db: AsyncSession = Depends(get_db),
    key: ApiKey = Depends(require_api_key),
) -> Any:
    _check_scope(key, "coa.send")
    acctuniqueid = body.get("acctuniqueid") or ""
    if not acctuniqueid:
        raise HTTPException(400, "acctuniqueid is required")
    from monsterops.modules.accounting.coa import send_disconnect
    from monsterops.modules.accounting.router import _resolve_session_and_nas

    session, nas = await _resolve_session_and_nas(acctuniqueid, db)
    nas_ip = str(session.nasipaddress).split("/")[0]
    return await send_disconnect(
        nas_ip=nas_ip,
        secret=nas.secret,
        username=session.username or "",
        session_id=session.acctsessionid,
        calling_station=session.callingstationid or None,
    )
