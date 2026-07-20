from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.nas.radius_attr_hints import get_hints
from monsterops.radius_reload import restart_freeradius

from .models import Nas, NasGroup, NasGroupMember, NasReachability, RadiusGroupNasGroup
from .schemas import (
    NasCreate,
    NasGroupCreate,
    NasGroupListItem,
    NasGroupListResponse,
    NasGroupMemberOut,
    NasGroupOut,
    NasGroupUpdate,
    NasListItem,
    NasListResponse,
    NasOut,
    NasReachabilityOut,
    NasSessionOut,
    NasUpdate,
    RadiusGroupLink,
)

router = APIRouter(prefix="/api/nas", tags=["nas"])




async def _nas_or_404(nas_id: int, db: AsyncSession) -> Nas:
    row = await db.scalar(select(Nas).where(Nas.id == nas_id))
    if not row:
        raise HTTPException(404, "NAS device not found")
    return row


async def _ng_or_404(ng_id: int, db: AsyncSession) -> NasGroup:
    row = await db.scalar(select(NasGroup).where(NasGroup.id == ng_id))
    if not row:
        raise HTTPException(404, "NAS group not found")
    return row




@router.get("", response_model=NasListResponse)
async def list_nas(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=128),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
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

    if not rows:
        return NasListResponse(total=total, page=page, size=size, items=[])

    nas_ips = [r.nasname for r in rows]
    sess_q = await db.execute(
        select(func.host(Radacct.nasipaddress).label("ip"), func.count().label("cnt"))
        .where(func.host(Radacct.nasipaddress).in_(nas_ips), Radacct.acctstoptime.is_(None))
        .group_by(func.host(Radacct.nasipaddress))
    )
    sess_map: dict[str, int] = {r.ip: r.cnt for r in sess_q.all()}

    items = [
        NasListItem(
            id=r.id,
            nasname=r.nasname,
            shortname=r.shortname or r.nasname,
            type=r.type or "other",
            description=r.description,
            active_sessions=sess_map.get(r.nasname, 0),
        )
        for r in rows
    ]
    return NasListResponse(total=total, page=page, size=size, items=items)


@router.post("", response_model=NasOut, status_code=201)
async def create_nas(
    body: NasCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="nas.create",
        target=body.nasname,
        detail={"shortname": body.shortname},
        request=request,
    )
    background_tasks.add_task(restart_freeradius)
    return NasOut.model_validate(row)




@router.get("/reachability", response_model=list[NasReachabilityOut])
async def list_reachability(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(NasReachability, Nas.shortname, Nas.nasname)
            .join(Nas, Nas.id == NasReachability.nas_id)
            .order_by(Nas.shortname)
        )
    ).all()
    return [
        NasReachabilityOut(
            nas_id=r.nas_id,
            shortname=shortname or nasname,
            nasname=nasname,
            status=r.status,
            method=r.method,
            last_rtt_ms=r.last_rtt_ms,
            last_seen_at=r.last_seen_at,
            last_probe_at=r.last_probe_at,
            detail=r.detail,
        )
        for r, shortname, nasname in rows
    ]


@router.post("/{nas_id}/probe", response_model=NasReachabilityOut)
async def probe_nas(
    nas_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    from monsterops.modules.nas.probe import probe_nas_now

    nas = await _nas_or_404(nas_id, db)
    row = await probe_nas_now(nas_id)
    if row is None:
        raise HTTPException(404, "NAS not found")
    return NasReachabilityOut(
        nas_id=nas_id,
        shortname=nas.shortname or nas.nasname,
        nasname=nas.nasname,
        status=row.status,
        method=row.method,
        last_rtt_ms=row.last_rtt_ms,
        last_seen_at=row.last_seen_at,
        last_probe_at=row.last_probe_at,
        detail=row.detail,
    )


@router.get("/{nas_id}", response_model=NasOut)
async def get_nas(nas_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    return NasOut.model_validate(await _nas_or_404(nas_id, db))


@router.put("/{nas_id}", response_model=NasOut)
async def update_nas(
    nas_id: int,
    body: NasUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await _nas_or_404(nas_id, db)
    changed: list[str] = []

    if body.nasname is not None and body.nasname != row.nasname:
        if await db.scalar(
            select(func.count())
            .select_from(Nas)
            .where(Nas.nasname == body.nasname, Nas.id != nas_id)
        ):
            raise HTTPException(409, f"NAS '{body.nasname}' already exists")
        row.nasname = body.nasname
        changed.append("nasname")
    for field in ("shortname", "type", "ports", "secret", "server", "community", "description"):
        val = getattr(body, field)
        if val is not None:
            setattr(row, field, val)
            changed.append(field)

    if changed:
        await db.commit()
        await db.refresh(row)
        await audit(
            db,
            user_id=current.id,
            username=current.username,
            action="nas.update",
            target=row.nasname,
            detail={"changed": changed},
            request=request,
        )
        background_tasks.add_task(restart_freeradius)
    return NasOut.model_validate(row)


@router.delete("/{nas_id}", status_code=204)
async def delete_nas(
    nas_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await _nas_or_404(nas_id, db)
    nasname = row.nasname
    await db.delete(row)
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="nas.delete",
        target=nasname,
        detail={},
        request=request,
    )
    background_tasks.add_task(restart_freeradius)


@router.get("/{nas_id}/groups")
async def get_nas_device_groups(
    nas_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _nas_or_404(nas_id, db)
    q = await db.execute(
        select(NasGroupMember, NasGroup)
        .join(NasGroup, NasGroupMember.nas_group_id == NasGroup.id)
        .where(NasGroupMember.nas_id == nas_id)
        .order_by(NasGroup.name)
    )
    return [
        {
            "member_id": m.id,
            "group_id": ng.id,
            "group_name": ng.name,
            "group_description": ng.description,
        }
        for m, ng in q.all()
    ]


@router.get("/{nas_id}/sessions", response_model=list[NasSessionOut])
async def get_nas_sessions(
    nas_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    row = await _nas_or_404(nas_id, db)
    q = await db.execute(
        select(Radacct)
        .where(func.host(Radacct.nasipaddress) == row.nasname, Radacct.acctstoptime.is_(None))
        .order_by(Radacct.acctstarttime.desc())
        .limit(200)
    )
    return [
        NasSessionOut(
            radacctid=s.radacctid,
            username=s.username,
            nasportid=s.nasportid,
            framedipaddress=str(s.framedipaddress) if s.framedipaddress else None,
            callingstationid=s.callingstationid,
            acctstarttime=s.acctstarttime,
            acctsessiontime=s.acctsessiontime,
            acctinputoctets=s.acctinputoctets,
            acctoutputoctets=s.acctoutputoctets,
        )
        for s in q.scalars().all()
    ]




@router.get("/groups/list", response_model=NasGroupListResponse)
async def list_nas_groups(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=128),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    base = select(NasGroup)
    if search:
        base = base.where(NasGroup.name.ilike(f"%{search}%"))

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        (await db.execute(base.order_by(NasGroup.name).limit(size).offset((page - 1) * size)))
        .scalars()
        .all()
    )

    if not rows:
        return NasGroupListResponse(total=total, page=page, size=size, items=[])

    ids = [r.id for r in rows]
    dev_q = await db.execute(
        select(NasGroupMember.nas_group_id, func.count().label("cnt"))
        .where(NasGroupMember.nas_group_id.in_(ids))
        .group_by(NasGroupMember.nas_group_id)
    )
    dev_map = {r.nas_group_id: r.cnt for r in dev_q.all()}

    rg_q = await db.execute(
        select(RadiusGroupNasGroup.nas_group_id, func.count().label("cnt"))
        .where(RadiusGroupNasGroup.nas_group_id.in_(ids))
        .group_by(RadiusGroupNasGroup.nas_group_id)
    )
    rg_map = {r.nas_group_id: r.cnt for r in rg_q.all()}

    items = [
        NasGroupListItem(
            id=r.id,
            name=r.name,
            description=r.description,
            device_count=dev_map.get(r.id, 0),
            radius_group_count=rg_map.get(r.id, 0),
        )
        for r in rows
    ]
    return NasGroupListResponse(total=total, page=page, size=size, items=items)


@router.post("/groups/list", response_model=NasGroupOut, status_code=201)
async def create_nas_group(
    body: NasGroupCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if await db.scalar(
        select(func.count()).select_from(NasGroup).where(NasGroup.name == body.name)
    ):
        raise HTTPException(409, f"NAS group '{body.name}' already exists")
    row = NasGroup(name=body.name, description=body.description)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="nas_group.create",
        target=body.name,
        detail={},
        request=request,
    )
    return NasGroupOut.model_validate(row)


@router.get("/groups/{ng_id}", response_model=NasGroupOut)
async def get_nas_group(
    ng_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    return NasGroupOut.model_validate(await _ng_or_404(ng_id, db))


@router.put("/groups/{ng_id}", response_model=NasGroupOut)
async def update_nas_group(
    ng_id: int,
    body: NasGroupUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await _ng_or_404(ng_id, db)
    changed: list[str] = []
    if body.name is not None and body.name != row.name:
        if await db.scalar(
            select(func.count())
            .select_from(NasGroup)
            .where(NasGroup.name == body.name, NasGroup.id != ng_id)
        ):
            raise HTTPException(409, f"NAS group '{body.name}' already exists")
        row.name = body.name
        changed.append("name")
    if body.description is not None:
        row.description = body.description
        changed.append("description")
    if changed:
        await db.commit()
        await db.refresh(row)
        await audit(
            db,
            user_id=current.id,
            username=current.username,
            action="nas_group.update",
            target=row.name,
            detail={"changed": changed},
            request=request,
        )
    return NasGroupOut.model_validate(row)


@router.delete("/groups/{ng_id}", status_code=204)
async def delete_nas_group(
    ng_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await _ng_or_404(ng_id, db)
    name = row.name
    await db.delete(row)
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="nas_group.delete",
        target=name,
        detail={},
        request=request,
    )




@router.get("/groups/{ng_id}/members", response_model=list[NasGroupMemberOut])
async def list_ng_members(
    ng_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    await _ng_or_404(ng_id, db)
    q = await db.execute(
        select(NasGroupMember, Nas)
        .join(Nas, NasGroupMember.nas_id == Nas.id)
        .where(NasGroupMember.nas_group_id == ng_id)
        .order_by(Nas.shortname, Nas.nasname)
    )
    return [
        NasGroupMemberOut(
            id=m.id,
            nas_id=n.id,
            nasname=n.nasname,
            shortname=n.shortname or n.nasname,
            type=n.type or "other",
        )
        for m, n in q.all()
    ]


@router.post("/groups/{ng_id}/members", status_code=201)
async def add_ng_member(
    ng_id: int,
    nas_id: int = Query(..., description="NAS device ID to add"),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _ng_or_404(ng_id, db)
    await _nas_or_404(nas_id, db)
    if await db.scalar(
        select(func.count())
        .select_from(NasGroupMember)
        .where(NasGroupMember.nas_group_id == ng_id, NasGroupMember.nas_id == nas_id)
    ):
        raise HTTPException(409, "NAS device already in this group")
    db.add(NasGroupMember(nas_group_id=ng_id, nas_id=nas_id))
    await db.commit()
    return {"ok": True}


@router.delete("/groups/{ng_id}/members/{member_id}", status_code=204)
async def remove_ng_member(
    ng_id: int,
    member_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await db.scalar(
        select(NasGroupMember).where(
            NasGroupMember.id == member_id, NasGroupMember.nas_group_id == ng_id
        )
    )
    if not row:
        raise HTTPException(404, "Member not found")
    await db.delete(row)
    await db.commit()




@router.get("/groups/{ng_id}/radius-groups", response_model=list[RadiusGroupLink])
async def list_ng_radius_groups(
    ng_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    await _ng_or_404(ng_id, db)
    q = await db.execute(
        select(RadiusGroupNasGroup)
        .where(RadiusGroupNasGroup.nas_group_id == ng_id)
        .order_by(RadiusGroupNasGroup.radius_groupname)
    )
    return [
        RadiusGroupLink(id=r.id, radius_groupname=r.radius_groupname) for r in q.scalars().all()
    ]


@router.post("/groups/{ng_id}/radius-groups", status_code=201)
async def link_radius_group(
    ng_id: int,
    body: RadiusGroupLink,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _ng_or_404(ng_id, db)
    if await db.scalar(
        select(func.count())
        .select_from(RadiusGroupNasGroup)
        .where(
            RadiusGroupNasGroup.nas_group_id == ng_id,
            RadiusGroupNasGroup.radius_groupname == body.radius_groupname,
        )
    ):
        raise HTTPException(409, "Group already linked")
    db.add(RadiusGroupNasGroup(nas_group_id=ng_id, radius_groupname=body.radius_groupname))
    await db.commit()
    return {"ok": True}


@router.delete("/groups/{ng_id}/radius-groups/{link_id}", status_code=204)
async def unlink_radius_group(
    ng_id: int,
    link_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    row = await db.scalar(
        select(RadiusGroupNasGroup).where(
            RadiusGroupNasGroup.id == link_id, RadiusGroupNasGroup.nas_group_id == ng_id
        )
    )
    if not row:
        raise HTTPException(404, "Link not found")
    await db.delete(row)
    await db.commit()




@router.get("/groups/links/{radius_groupname}")
async def list_links_for_radius_group(
    radius_groupname: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = await db.execute(
        select(RadiusGroupNasGroup, NasGroup)
        .join(NasGroup, RadiusGroupNasGroup.nas_group_id == NasGroup.id)
        .where(RadiusGroupNasGroup.radius_groupname == radius_groupname)
        .order_by(NasGroup.name)
    )
    return [
        {"link_id": link.id, "nas_group_id": ng.id, "nas_group_name": ng.name}
        for link, ng in q.all()
    ]


@router.get("/groups/hints/{radius_groupname}")
async def get_attribute_hints(
    radius_groupname: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    ng_ids_q = await db.execute(
        select(RadiusGroupNasGroup.nas_group_id).where(
            RadiusGroupNasGroup.radius_groupname == radius_groupname
        )
    )
    ng_ids = [r[0] for r in ng_ids_q.all()]
    if not ng_ids:
        return {"hints": [], "vendors": [], "nas_groups": []}

    types_q = await db.execute(
        select(Nas.type)
        .distinct()
        .join(NasGroupMember, NasGroupMember.nas_id == Nas.id)
        .where(NasGroupMember.nas_group_id.in_(ng_ids))
    )
    nas_types = [r[0] for r in types_q.all() if r[0]]

    ng_names_q = await db.execute(select(NasGroup.name).where(NasGroup.id.in_(ng_ids)))
    ng_names = [r[0] for r in ng_names_q.all()]

    result = get_hints(nas_types)
    result["nas_groups"] = ng_names
    return result
