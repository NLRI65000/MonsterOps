from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.nas.models import NasGroup
from monsterops.modules.realms.models import (
    HomeServer,
    HomeServerPool,
    HomeServerPoolMember,
    NasGroupRealm,
    Realm,
)
from monsterops.modules.realms.probe import check_interface_up, probe_server
from monsterops.modules.realms.proxyconf import generate_proxy_conf
from monsterops.modules.realms.schemas import (
    HomeServerCreate,
    HomeServerOut,
    HomeServerUpdate,
    NasGroupRealmCreate,
    NasGroupRealmOut,
    PoolCreate,
    PoolOut,
    ProxyConfApplyResult,
    ProxyConfPreview,
    RealmCreate,
    RealmOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/realms", tags=["realms"])


async def _server_out(s: HomeServer) -> HomeServerOut:
    out = HomeServerOut.model_validate(s)
    if s.vpn_interface:
        out.vpn_interface_up = await check_interface_up(s.vpn_interface)
    return out


def _pool_status(members: list[HomeServer]) -> str:
    if not members:
        return "unknown"
    statuses = {m.status for m in members}
    if "up" in statuses:
        return "up"
    if statuses <= {"unknown"}:
        return "unknown"
    return "down"



@router.get("/servers", response_model=list[HomeServerOut])
async def list_servers(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    servers = (await db.execute(select(HomeServer).order_by(HomeServer.name))).scalars().all()
    return [await _server_out(s) for s in servers]


@router.post("/servers", response_model=HomeServerOut, status_code=201)
async def create_server(
    body: HomeServerCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(select(func.count()).select_from(HomeServer).where(HomeServer.name == body.name))
    if dup:
        raise HTTPException(409, f"Home server '{body.name}' already exists")
    s = HomeServer(**body.model_dump())
    db.add(s)
    await db.flush()
    await audit(db, user_id=current.id, username=current.username,
                action="realm.server_create", target=body.name, request=request)
    await db.commit()
    await db.refresh(s)
    return await _server_out(s)


@router.put("/servers/{server_id}", response_model=HomeServerOut)
async def update_server(
    server_id: int,
    body: HomeServerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    s = await db.get(HomeServer, server_id)
    if not s:
        raise HTTPException(404, "Home server not found")
    dup = await db.scalar(
        select(func.count()).select_from(HomeServer)
        .where(HomeServer.name == body.name, HomeServer.id != server_id)
    )
    if dup:
        raise HTTPException(409, f"Home server '{body.name}' already exists")
    data = body.model_dump()
    if not data["secret"]:
        data.pop("secret")
    for k, v in data.items():
        setattr(s, k, v)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.server_update", target=s.name, request=request)
    await db.commit()
    await db.refresh(s)
    return await _server_out(s)


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(
    server_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    s = await db.get(HomeServer, server_id)
    if not s:
        raise HTTPException(404, "Home server not found")
    await db.delete(s)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.server_delete", target=s.name, request=request)
    await db.commit()


@router.post("/servers/{server_id}/probe", response_model=HomeServerOut)
async def probe_now(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    from datetime import datetime, timezone

    s = await db.get(HomeServer, server_id)
    if not s:
        raise HTTPException(404, "Home server not found")
    port = s.auth_port if s.type != "acct" else s.acct_port
    status, rtt = await probe_server(s.host, port, s.secret)
    now = datetime.now(tz=timezone.utc)
    s.status = status
    s.last_rtt_ms = rtt
    s.last_probe_at = now
    if status == "up":
        s.last_seen_at = now
    await db.commit()
    await db.refresh(s)
    return await _server_out(s)



async def _pool_out(p: HomeServerPool, db: AsyncSession) -> PoolOut:
    members = (
        await db.execute(
            select(HomeServer)
            .join(HomeServerPoolMember, HomeServerPoolMember.server_id == HomeServer.id)
            .where(HomeServerPoolMember.pool_id == p.id)
            .order_by(HomeServerPoolMember.position)
        )
    ).scalars().all()
    return PoolOut(
        id=p.id, name=p.name, pool_type=p.pool_type,
        server_ids=[int(m.id) for m in members],
        server_names=[str(m.name) for m in members],
        status=_pool_status(members),
        created_at=p.created_at,
    )


async def _set_pool_members(pool_id: int, server_ids: list[int], db: AsyncSession) -> None:
    found = (
        await db.execute(select(HomeServer.id).where(HomeServer.id.in_(server_ids or [-1])))
    ).scalars().all()
    missing = set(server_ids) - set(found)
    if missing:
        raise HTTPException(422, f"Unknown home server ids: {sorted(missing)}")
    await db.execute(delete(HomeServerPoolMember).where(HomeServerPoolMember.pool_id == pool_id))
    for pos, sid in enumerate(server_ids):
        db.add(HomeServerPoolMember(pool_id=pool_id, server_id=sid, position=pos))


@router.get("/pools", response_model=list[PoolOut])
async def list_pools(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    pools = (await db.execute(select(HomeServerPool).order_by(HomeServerPool.name))).scalars().all()
    return [await _pool_out(p, db) for p in pools]


@router.post("/pools", response_model=PoolOut, status_code=201)
async def create_pool(
    body: PoolCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(select(func.count()).select_from(HomeServerPool).where(HomeServerPool.name == body.name))
    if dup:
        raise HTTPException(409, f"Pool '{body.name}' already exists")
    p = HomeServerPool(name=body.name, pool_type=body.pool_type)
    db.add(p)
    await db.flush()
    await _set_pool_members(p.id, body.server_ids, db)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.pool_create", target=body.name, request=request)
    await db.commit()
    await db.refresh(p)
    return await _pool_out(p, db)


@router.put("/pools/{pool_id}", response_model=PoolOut)
async def update_pool(
    pool_id: int,
    body: PoolCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    p = await db.get(HomeServerPool, pool_id)
    if not p:
        raise HTTPException(404, "Pool not found")
    dup = await db.scalar(
        select(func.count()).select_from(HomeServerPool)
        .where(HomeServerPool.name == body.name, HomeServerPool.id != pool_id)
    )
    if dup:
        raise HTTPException(409, f"Pool '{body.name}' already exists")
    p.name = body.name
    p.pool_type = body.pool_type
    await _set_pool_members(pool_id, body.server_ids, db)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.pool_update", target=p.name, request=request)
    await db.commit()
    await db.refresh(p)
    return await _pool_out(p, db)


@router.delete("/pools/{pool_id}", status_code=204)
async def delete_pool(
    pool_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    p = await db.get(HomeServerPool, pool_id)
    if not p:
        raise HTTPException(404, "Pool not found")
    await db.delete(p)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.pool_delete", target=p.name, request=request)
    await db.commit()



async def _realm_out(r: Realm, db: AsyncSession) -> RealmOut:
    pool_name = None
    status = "unknown"
    last_rtt = None
    last_probe = None
    if r.pool_id:
        p = await db.get(HomeServerPool, r.pool_id)
        if p:
            pool_name = p.name
            members = (
                await db.execute(
                    select(HomeServer)
                    .join(HomeServerPoolMember, HomeServerPoolMember.server_id == HomeServer.id)
                    .where(HomeServerPoolMember.pool_id == p.id)
                )
            ).scalars().all()
            status = _pool_status(members)
            up = [m for m in members if m.status == "up" and m.last_rtt_ms is not None]
            if up:
                last_rtt = min(m.last_rtt_ms for m in up)
            probed = [m.last_probe_at for m in members if m.last_probe_at]
            if probed:
                last_probe = max(probed)
            if status == "down":
                statuses = {m.status for m in members}
                if statuses == {"timeout"}:
                    status = "timeout"
    return RealmOut(
        id=r.id, name=r.name, pool_id=r.pool_id, pool_name=pool_name,
        strip_username=r.strip_username, status=status,
        last_rtt_ms=last_rtt, last_probe_at=last_probe, created_at=r.created_at,
    )


@router.get("", response_model=list[RealmOut])
async def list_realms(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    realms = (await db.execute(select(Realm).order_by(Realm.name))).scalars().all()
    return [await _realm_out(r, db) for r in realms]


@router.post("", response_model=RealmOut, status_code=201)
async def create_realm(
    body: RealmCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(select(func.count()).select_from(Realm).where(Realm.name == body.name))
    if dup:
        raise HTTPException(409, f"Realm '{body.name}' already exists")
    if body.pool_id is not None and not await db.get(HomeServerPool, body.pool_id):
        raise HTTPException(422, "Unknown pool_id")
    r = Realm(name=body.name, pool_id=body.pool_id, strip_username=body.strip_username)
    db.add(r)
    await db.flush()
    await audit(db, user_id=current.id, username=current.username,
                action="realm.create", target=body.name, request=request)
    await db.commit()
    await db.refresh(r)
    return await _realm_out(r, db)


@router.put("/{realm_id}", response_model=RealmOut)
async def update_realm(
    realm_id: int,
    body: RealmCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    r = await db.get(Realm, realm_id)
    if not r:
        raise HTTPException(404, "Realm not found")
    dup = await db.scalar(
        select(func.count()).select_from(Realm).where(Realm.name == body.name, Realm.id != realm_id)
    )
    if dup:
        raise HTTPException(409, f"Realm '{body.name}' already exists")
    if body.pool_id is not None and not await db.get(HomeServerPool, body.pool_id):
        raise HTTPException(422, "Unknown pool_id")
    r.name = body.name
    r.pool_id = body.pool_id
    r.strip_username = body.strip_username
    await audit(db, user_id=current.id, username=current.username,
                action="realm.update", target=r.name, request=request)
    await db.commit()
    await db.refresh(r)
    return await _realm_out(r, db)


@router.delete("/{realm_id}", status_code=204)
async def delete_realm(
    realm_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    r = await db.get(Realm, realm_id)
    if not r:
        raise HTTPException(404, "Realm not found")
    await db.delete(r)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.delete", target=r.name, request=request)
    await db.commit()



@router.get("/nas-routing", response_model=list[NasGroupRealmOut])
async def list_nas_routing(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(NasGroupRealm, NasGroup.name, Realm.name)
            .join(NasGroup, NasGroup.id == NasGroupRealm.nas_group_id)
            .join(Realm, Realm.id == NasGroupRealm.realm_id)
            .order_by(NasGroup.name)
        )
    ).all()
    return [
        NasGroupRealmOut(
            id=link.id, nas_group_id=link.nas_group_id, nas_group_name=gname,
            realm_id=link.realm_id, realm_name=rname,
        )
        for link, gname, rname in rows
    ]


@router.post("/nas-routing", response_model=NasGroupRealmOut, status_code=201)
async def create_nas_routing(
    body: NasGroupRealmCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    group = await db.get(NasGroup, body.nas_group_id)
    if not group:
        raise HTTPException(422, "Unknown nas_group_id")
    realm = await db.get(Realm, body.realm_id)
    if not realm:
        raise HTTPException(422, "Unknown realm_id")
    dup = await db.scalar(
        select(func.count()).select_from(NasGroupRealm).where(
            NasGroupRealm.nas_group_id == body.nas_group_id,
            NasGroupRealm.realm_id == body.realm_id,
        )
    )
    if dup:
        raise HTTPException(409, "This NAS group is already routed to that realm")
    link = NasGroupRealm(nas_group_id=body.nas_group_id, realm_id=body.realm_id)
    db.add(link)
    await db.flush()
    await audit(db, user_id=current.id, username=current.username,
                action="realm.route_create", target=f"{group.name} → {realm.name}", request=request)
    await db.commit()
    return NasGroupRealmOut(
        id=link.id, nas_group_id=group.id, nas_group_name=group.name,
        realm_id=realm.id, realm_name=realm.name,
    )


@router.delete("/nas-routing/{link_id}", status_code=204)
async def delete_nas_routing(
    link_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    link = await db.get(NasGroupRealm, link_id)
    if not link:
        raise HTTPException(404, "Routing link not found")
    await db.delete(link)
    await audit(db, user_id=current.id, username=current.username,
                action="realm.route_delete", target=str(link_id), request=request)
    await db.commit()



@router.get("/proxy-conf/preview", response_model=ProxyConfPreview)
async def preview_proxy_conf(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    content = await generate_proxy_conf(db)
    return ProxyConfPreview(content=content, path=settings.freeradius_proxy_conf)


@router.post("/proxy-conf/apply", response_model=ProxyConfApplyResult)
async def apply_proxy_conf(
    request: Request,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin")),
):
    from monsterops.radius_reload import restart_freeradius

    content = await generate_proxy_conf(db)
    path = Path(settings.freeradius_proxy_conf)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        try:
            path.chmod(0o640)
        except OSError:
            pass
    except OSError as exc:
        raise HTTPException(500, f"Could not write {path}: {exc}")

    await audit(db, user_id=current.id, username=current.username,
                action="realm.proxyconf_apply", target=str(path),
                detail={"bytes": len(content)}, request=request)
    await db.commit()

    background.add_task(restart_freeradius)
    return ProxyConfApplyResult(
        written=True, path=str(path), bytes=len(content), restart_triggered=True,
    )
