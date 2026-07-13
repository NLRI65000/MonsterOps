from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, func, select, union, update
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.users.models import Radusergroup
from .models import GroupAccessType, Radgroupcheck, Radgroupreply
from .schemas import (
    AttributeCreate, AttributeUpdate,
    GroupCreate, GroupDetail, GroupListItem, GroupListResponse, GroupRename,
    LoginTypeInfo, MemberAdd, MemberOut, RadgroupcheckRow, RadgroupreplyRow,
    SetAccessTypesBody,
)

_LOGIN_TYPES: dict[str, dict] = {
    "dot1x": {
        "label": "802.1X (EAP)",
        "description": "Port-based network access control using EAP (e.g. EAP-TLS, PEAP, EAP-TTLS). Detected when EAP-Message attribute is present in the Access-Request.",
        "vendors": ["cisco", "huawei", "mikrotik", "generic"],
        "detect": "EAP-Message present in request",
    },
    "pppoe": {
        "label": "PPPoE",
        "description": "Point-to-Point Protocol over Ethernet. Detected via Framed-Protocol=PPP + NAS-Port-Type=Ethernet.",
        "vendors": ["mikrotik", "huawei", "cisco"],
        "detect": "NAS-Port-Type=Ethernet + Framed-Protocol=PPP",
    },
    "l2tp": {
        "label": "L2TP",
        "description": "Layer 2 Tunneling Protocol. Detected via NAS-Port-Type=Virtual. When Tunnel-Type=L2TP is not sent (common on MikroTik), matched alongside pptp/sstp.",
        "vendors": ["mikrotik", "huawei", "cisco"],
        "detect": "NAS-Port-Type=Virtual (+ Tunnel-Type=L2TP when sent)",
    },
    "pptp": {
        "label": "PPTP",
        "description": "Point-to-Point Tunneling Protocol. Detected via NAS-Port-Type=Virtual + Tunnel-Type=PPTP. Note: MikroTik does not always send Tunnel-Type.",
        "vendors": ["mikrotik", "cisco"],
        "detect": "NAS-Port-Type=Virtual + Tunnel-Type=PPTP",
    },
    "sstp": {
        "label": "SSTP",
        "description": "Secure Socket Tunneling Protocol (Microsoft). MikroTik sends NAS-Port-Type=Virtual without a Tunnel-Type attribute, so SSTP, L2TP, and PPTP share the virtual-port fallback bucket.",
        "vendors": ["mikrotik"],
        "detect": "NAS-Port-Type=Virtual (no Tunnel-Type; fallback with l2tp/pptp)",
    },
    "hotspot": {
        "label": "Hotspot / Captive Portal",
        "description": "Web-based login portal. Detected via Service-Type=Login-User.",
        "vendors": ["mikrotik", "cisco"],
        "detect": "Service-Type=Login-User",
    },
    "wireless": {
        "label": "Wireless (non-EAP)",
        "description": "Wi-Fi association without EAP (e.g. WPA2-PSK with RADIUS MAC auth). Detected via NAS-Port-Type=Wireless-802.11.",
        "vendors": ["cisco", "huawei", "mikrotik"],
        "detect": "NAS-Port-Type=Wireless-802.11",
    },
    "ipoe": {
        "label": "IPoE / DHCP",
        "description": "IP over Ethernet without PPP encapsulation. Common on Huawei BNG. Detected via Service-Type=Framed-User + NAS-Port-Type=Ethernet with no Framed-Protocol.",
        "vendors": ["huawei"],
        "detect": "NAS-Port-Type=Ethernet + Service-Type=Framed-User, no Framed-Protocol",
    },
    "admin": {
        "label": "Admin / Management (SSH, Winbox, Telnet, API)",
        "description": "Management-plane logins to the NAS itself. MikroTik sends Service-Type=Administrative-User for SSH, Winbox, and API; Service-Type=NAS-Prompt-User for Telnet. Cisco uses the same values for exec/priv sessions.",
        "vendors": ["mikrotik", "cisco", "huawei", "generic"],
        "detect": "Service-Type=Administrative-User or Service-Type=NAS-Prompt-User",
    },
}

router = APIRouter(prefix="/api/groups", tags=["groups"])



@router.get("/login-types", response_model=list[LoginTypeInfo])
async def list_login_types(_user=Depends(get_current_user)):
    return [
        LoginTypeInfo(key=k, label=v["label"], description=v["description"],
                      vendors=v["vendors"], detect=v["detect"])
        for k, v in _LOGIN_TYPES.items()
    ]


async def _exists_or_404(groupname: str, db: AsyncSession) -> str:
    for table in (Radgroupcheck, Radgroupreply, Radusergroup):
        q = await db.execute(
            select(func.count()).select_from(table).where(table.groupname == groupname)
        )
        if q.scalar_one():
            return groupname
    raise HTTPException(404, f"Group '{groupname}' not found")



@router.get("", response_model=GroupListResponse)
async def list_groups(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    union_stmt = union(
        select(Radgroupcheck.groupname),
        select(Radgroupreply.groupname),
        select(Radusergroup.groupname),
    )
    sub = union_stmt.subquery()
    base = select(sub.c.groupname).distinct()
    if search:
        base = base.where(sub.c.groupname.ilike(f"%{search}%"))

    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_q.scalar_one() or 0

    name_order = sub.c.groupname.desc() if order == "desc" else sub.c.groupname.asc()
    names_q = await db.execute(
        base.order_by(name_order).limit(size).offset((page - 1) * size)
    )
    names = [r[0] for r in names_q.all()]

    if not names:
        return GroupListResponse(total=total, page=page, size=size, items=[])

    mem_q = await db.execute(
        select(Radusergroup.groupname, func.count().label("cnt"))
        .where(Radusergroup.groupname.in_(names))
        .group_by(Radusergroup.groupname)
    )
    chk_q = await db.execute(
        select(Radgroupcheck.groupname, func.count().label("cnt"))
        .where(Radgroupcheck.groupname.in_(names))
        .group_by(Radgroupcheck.groupname)
    )
    rpl_q = await db.execute(
        select(Radgroupreply.groupname, func.count().label("cnt"))
        .where(Radgroupreply.groupname.in_(names))
        .group_by(Radgroupreply.groupname)
    )
    mem_map  = {r.groupname: r.cnt for r in mem_q.all()}
    chk_map  = {r.groupname: r.cnt for r in chk_q.all()}
    rpl_map  = {r.groupname: r.cnt for r in rpl_q.all()}

    items = [
        GroupListItem(
            name=n,
            member_count=mem_map.get(n, 0),
            check_count=chk_map.get(n, 0),
            reply_count=rpl_map.get(n, 0),
        )
        for n in names
    ]
    return GroupListResponse(total=total, page=page, size=size, items=items)



@router.post("", status_code=201)
async def create_group(
    body: GroupCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    for table in (Radgroupcheck, Radgroupreply, Radusergroup):
        q = await db.execute(
            select(func.count()).select_from(table).where(table.groupname == body.name)
        )
        if q.scalar_one():
            raise HTTPException(409, f"Group '{body.name}' already exists")

    db.add(Radgroupcheck(groupname=body.name, attribute="Fall-Through", op=":=", value="No"))
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.create", target=body.name, detail={}, request=request)
    return {"name": body.name}



@router.get("/{groupname}", response_model=GroupDetail)
async def get_group(
    groupname: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _exists_or_404(groupname, db)

    chk_q = await db.execute(
        select(Radgroupcheck).where(Radgroupcheck.groupname == groupname).order_by(Radgroupcheck.id)
    )
    rpl_q = await db.execute(
        select(Radgroupreply).where(Radgroupreply.groupname == groupname).order_by(Radgroupreply.id)
    )
    mem_q = await db.execute(
        select(func.count()).select_from(Radusergroup).where(Radusergroup.groupname == groupname)
    )

    at_q = await db.execute(
        select(GroupAccessType.login_type).where(GroupAccessType.groupname == groupname)
    )
    return GroupDetail(
        name=groupname,
        check_attrs=[RadgroupcheckRow.model_validate(r) for r in chk_q.scalars().all()],
        reply_attrs=[RadgroupreplyRow.model_validate(r) for r in rpl_q.scalars().all()],
        member_count=mem_q.scalar_one() or 0,
        access_types=[r[0] for r in at_q.all()],
    )



@router.put("/{groupname}/rename")
async def rename_group(
    groupname: str,
    body: GroupRename,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)
    if body.name == groupname:
        return {"name": groupname}

    for table in (Radgroupcheck, Radgroupreply, Radusergroup):
        q = await db.execute(
            select(func.count()).select_from(table).where(table.groupname == body.name)
        )
        if q.scalar_one():
            raise HTTPException(409, f"Group '{body.name}' already exists")

    await db.execute(update(Radgroupcheck).where(Radgroupcheck.groupname == groupname).values(groupname=body.name))
    await db.execute(update(Radgroupreply).where(Radgroupreply.groupname == groupname).values(groupname=body.name))
    await db.execute(update(Radusergroup).where(Radusergroup.groupname == groupname).values(groupname=body.name))
    await db.execute(update(GroupAccessType).where(GroupAccessType.groupname == groupname).values(groupname=body.name))
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.rename", target=groupname, detail={"new_name": body.name}, request=request)
    return {"name": body.name}



@router.delete("/{groupname}", status_code=204)
async def delete_group(
    groupname: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)
    await db.execute(delete(Radgroupcheck).where(Radgroupcheck.groupname == groupname))
    await db.execute(delete(Radgroupreply).where(Radgroupreply.groupname == groupname))
    await db.execute(delete(Radusergroup).where(Radusergroup.groupname == groupname))
    await db.execute(delete(GroupAccessType).where(GroupAccessType.groupname == groupname))
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.delete", target=groupname, detail={}, request=request)



@router.post("/{groupname}/check", status_code=201, response_model=RadgroupcheckRow)
async def add_check_attr(
    groupname: str,
    body: AttributeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)
    row = Radgroupcheck(groupname=groupname, attribute=body.attribute, op=body.op, value=body.value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RadgroupcheckRow.model_validate(row)


@router.put("/{groupname}/check/{attr_id}", response_model=RadgroupcheckRow)
async def update_check_attr(
    groupname: str,
    attr_id: int,
    body: AttributeUpdate,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radgroupcheck).where(Radgroupcheck.id == attr_id, Radgroupcheck.groupname == groupname)
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    if body.op is not None:
        row.op = body.op
    if body.value is not None:
        row.value = body.value
    await db.commit()
    await db.refresh(row)
    return RadgroupcheckRow.model_validate(row)


@router.delete("/{groupname}/check/{attr_id}", status_code=204)
async def delete_check_attr(
    groupname: str,
    attr_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radgroupcheck).where(Radgroupcheck.id == attr_id, Radgroupcheck.groupname == groupname)
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    await db.delete(row)
    await db.commit()



@router.post("/{groupname}/reply", status_code=201, response_model=RadgroupreplyRow)
async def add_reply_attr(
    groupname: str,
    body: AttributeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)
    row = Radgroupreply(groupname=groupname, attribute=body.attribute, op=body.op, value=body.value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RadgroupreplyRow.model_validate(row)


@router.put("/{groupname}/reply/{attr_id}", response_model=RadgroupreplyRow)
async def update_reply_attr(
    groupname: str,
    attr_id: int,
    body: AttributeUpdate,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radgroupreply).where(Radgroupreply.id == attr_id, Radgroupreply.groupname == groupname)
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    if body.op is not None:
        row.op = body.op
    if body.value is not None:
        row.value = body.value
    await db.commit()
    await db.refresh(row)
    return RadgroupreplyRow.model_validate(row)


@router.delete("/{groupname}/reply/{attr_id}", status_code=204)
async def delete_reply_attr(
    groupname: str,
    attr_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radgroupreply).where(Radgroupreply.id == attr_id, Radgroupreply.groupname == groupname)
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    await db.delete(row)
    await db.commit()



@router.get("/{groupname}/members", response_model=list[MemberOut])
async def list_members(
    groupname: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _exists_or_404(groupname, db)
    q = await db.execute(
        select(Radusergroup.username, Radusergroup.priority)
        .where(Radusergroup.groupname == groupname)
        .order_by(Radusergroup.priority, Radusergroup.username)
    )
    return [MemberOut(username=r.username, priority=r.priority) for r in q.all()]


@router.post("/{groupname}/members", status_code=201)
async def add_member(
    groupname: str,
    body: MemberAdd,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)
    q = await db.execute(
        select(func.count()).select_from(Radusergroup).where(
            Radusergroup.groupname == groupname,
            Radusergroup.username == body.username,
        )
    )
    if q.scalar_one():
        raise HTTPException(409, f"'{body.username}' is already in group '{groupname}'")
    db.add(Radusergroup(username=body.username, groupname=groupname, priority=body.priority))
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.member.add", target=groupname,
                detail={"username": body.username}, request=request)
    return {"ok": True}


@router.delete("/{groupname}/members/{username}", status_code=204)
async def remove_member(
    groupname: str,
    username: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radusergroup).where(
            Radusergroup.groupname == groupname,
            Radusergroup.username == username,
        )
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Member not found")
    await db.delete(row)
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.member.remove", target=groupname,
                detail={"username": username}, request=request)


@router.put("/{groupname}/members/{username}/priority")
async def set_member_priority(
    groupname: str,
    username: str,
    priority: int = Query(..., ge=0),
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radusergroup).where(
            Radusergroup.groupname == groupname,
            Radusergroup.username == username,
        )
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Member not found")
    row.priority = priority
    await db.commit()
    return {"ok": True}



@router.get("/{groupname}/access-types", response_model=list[str])
async def get_access_types(
    groupname: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _exists_or_404(groupname, db)
    q = await db.execute(
        select(GroupAccessType.login_type).where(GroupAccessType.groupname == groupname)
    )
    return [r[0] for r in q.all()]


@router.put("/{groupname}/access-types")
async def set_access_types(
    groupname: str,
    body: SetAccessTypesBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(groupname, db)

    if not body.enabled:
        await db.execute(delete(GroupAccessType).where(GroupAccessType.groupname == groupname))
        await db.commit()
        await audit(db, user_id=current.id, username=current.username,
                    action="group.access_types.set", target=groupname,
                    detail={"enabled": False}, request=request)
        return {"enabled": False, "types": []}

    if not body.types:
        raise HTTPException(422, "Select at least one login type when restriction is enabled")

    unknown = [t for t in body.types if t not in _LOGIN_TYPES]
    if unknown:
        raise HTTPException(422, f"Unknown login type(s): {', '.join(unknown)}")

    await db.execute(delete(GroupAccessType).where(GroupAccessType.groupname == groupname))
    for lt in body.types:
        db.add(GroupAccessType(groupname=groupname, login_type=lt))
    await db.commit()
    await audit(db, user_id=current.id, username=current.username,
                action="group.access_types.set", target=groupname,
                detail={"enabled": True, "types": body.types}, request=request)
    return {"enabled": True, "types": body.types}
