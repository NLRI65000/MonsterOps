from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.nas.models import NasGroup
from monsterops.modules.nas_manager.crypto import decrypt, encrypt
from monsterops.modules.realms import ldap_probe, ldap_sync
from monsterops.modules.realms.enforcement import adapter
from monsterops.modules.realms.models import (
    HomeServer,
    HomeServerPool,
    HomeServerPoolMember,
    MrAuthDomain,
    MrAuthDomainNasGroup,
    MrAuthGroupMap,
    MrIdentitySource,
    NasGroupRealm,
    Realm,
)
from monsterops.modules.realms.probe import check_interface_up, probe_server
from monsterops.modules.realms.proxyconf import generate_proxy_conf
from monsterops.modules.realms.schemas import (
    AuthDomainCreate,
    AuthDomainOut,
    AuthImportCandidates,
    AuthImportRequest,
    HomeServerCreate,
    HomeServerOut,
    HomeServerUpdate,
    HostDelegationStatus,
    IdentitySourceOut,
    LdapAdGroup,
    LdapGroupMapCreate,
    LdapGroupMapOut,
    LdapSyncResult,
    LdapSyncRun,
    LdapTestResult,
    NasGroupRealmCreate,
    NasGroupRealmOut,
    PoolCreate,
    PoolOut,
    ProxyConfApplyResult,
    ProxyConfPreview,
    RealmCreate,
    RealmOut,
)
from monsterops.modules.scheduler.service import (
    schedule_domain_sync,
    unschedule_domain_sync,
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
    dup = await db.scalar(
        select(func.count()).select_from(HomeServer).where(HomeServer.name == body.name)
    )
    if dup:
        raise HTTPException(409, f"Home server '{body.name}' already exists")
    s = HomeServer(**body.model_dump())
    db.add(s)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.server_create",
        target=body.name,
        request=request,
    )
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
        select(func.count())
        .select_from(HomeServer)
        .where(HomeServer.name == body.name, HomeServer.id != server_id)
    )
    if dup:
        raise HTTPException(409, f"Home server '{body.name}' already exists")
    data = body.model_dump()
    if not data["secret"]:
        data.pop("secret")
    for k, v in data.items():
        setattr(s, k, v)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.server_update",
        target=s.name,
        request=request,
    )
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.server_delete",
        target=s.name,
        request=request,
    )
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
        (
            await db.execute(
                select(HomeServer)
                .join(HomeServerPoolMember, HomeServerPoolMember.server_id == HomeServer.id)
                .where(HomeServerPoolMember.pool_id == p.id)
                .order_by(HomeServerPoolMember.position)
            )
        )
        .scalars()
        .all()
    )
    return PoolOut(
        id=p.id,
        name=p.name,
        pool_type=p.pool_type,
        server_ids=[int(m.id) for m in members],
        server_names=[str(m.name) for m in members],
        status=_pool_status(members),
        created_at=p.created_at,
    )


async def _set_pool_members(pool_id: int, server_ids: list[int], db: AsyncSession) -> None:
    found = (
        (await db.execute(select(HomeServer.id).where(HomeServer.id.in_(server_ids or [-1]))))
        .scalars()
        .all()
    )
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
    dup = await db.scalar(
        select(func.count()).select_from(HomeServerPool).where(HomeServerPool.name == body.name)
    )
    if dup:
        raise HTTPException(409, f"Pool '{body.name}' already exists")
    p = HomeServerPool(name=body.name, pool_type=body.pool_type)
    db.add(p)
    await db.flush()
    await _set_pool_members(p.id, body.server_ids, db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.pool_create",
        target=body.name,
        request=request,
    )
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
        select(func.count())
        .select_from(HomeServerPool)
        .where(HomeServerPool.name == body.name, HomeServerPool.id != pool_id)
    )
    if dup:
        raise HTTPException(409, f"Pool '{body.name}' already exists")
    p.name = body.name
    p.pool_type = body.pool_type
    await _set_pool_members(pool_id, body.server_ids, db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.pool_update",
        target=p.name,
        request=request,
    )
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.pool_delete",
        target=p.name,
        request=request,
    )
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
                (
                    await db.execute(
                        select(HomeServer)
                        .join(HomeServerPoolMember, HomeServerPoolMember.server_id == HomeServer.id)
                        .where(HomeServerPoolMember.pool_id == p.id)
                    )
                )
                .scalars()
                .all()
            )
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
        id=r.id,
        name=r.name,
        pool_id=r.pool_id,
        pool_name=pool_name,
        strip_username=r.strip_username,
        status=status,
        last_rtt_ms=last_rtt,
        last_probe_at=last_probe,
        created_at=r.created_at,
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.create",
        target=body.name,
        request=request,
    )
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.update",
        target=r.name,
        request=request,
    )
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.delete",
        target=r.name,
        request=request,
    )
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
            id=link.id,
            nas_group_id=link.nas_group_id,
            nas_group_name=gname,
            realm_id=link.realm_id,
            realm_name=rname,
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
        select(func.count())
        .select_from(NasGroupRealm)
        .where(
            NasGroupRealm.nas_group_id == body.nas_group_id,
            NasGroupRealm.realm_id == body.realm_id,
        )
    )
    if dup:
        raise HTTPException(409, "This NAS group is already routed to that realm")
    link = NasGroupRealm(nas_group_id=body.nas_group_id, realm_id=body.realm_id)
    db.add(link)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.route_create",
        target=f"{group.name} → {realm.name}",
        request=request,
    )
    await db.commit()
    return NasGroupRealmOut(
        id=link.id,
        nas_group_id=group.id,
        nas_group_name=group.name,
        realm_id=realm.id,
        realm_name=realm.name,
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
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.route_delete",
        target=str(link_id),
        request=request,
    )
    await db.commit()




def _source_out(s: MrIdentitySource) -> IdentitySourceOut:
    return IdentitySourceOut(
        id=s.id,
        name=s.name,
        source_type=s.source_type,
        host=s.host,
        port=s.port,
        encryption=s.encryption,
        base_dn=s.base_dn,
        bind_dn=s.bind_dn,
        has_bind_password=bool(s.bind_password_enc),
        tls_verify=s.tls_verify,
        timeout=s.timeout,
        login_attribute=s.login_attribute,
        strip_login_suffix=s.strip_login_suffix,
        user_search_base=s.user_search_base,
        user_search_filter=s.user_search_filter,
        status=s.status,
        last_rtt_ms=s.last_rtt_ms,
        last_probe_at=s.last_probe_at,
        created_at=s.created_at,
    )


async def _domain_out(d: MrAuthDomain, db: AsyncSession) -> AuthDomainOut:
    source = await db.get(MrIdentitySource, d.identity_source_id) if d.identity_source_id else None
    bindings = (
        (
            await db.execute(
                select(MrAuthDomainNasGroup).where(MrAuthDomainNasGroup.auth_domain_id == d.id)
            )
        )
        .scalars()
        .all()
    )
    gids = [b.nas_group_id for b in bindings]
    names: list[str] = []
    if gids:
        rows = (
            await db.execute(select(NasGroup.id, NasGroup.name).where(NasGroup.id.in_(gids)))
        ).all()
        idname = {r[0]: r[1] for r in rows}
        names = [idname.get(g, str(g)) for g in gids]
    src_type = source.source_type if source else None
    return AuthDomainOut(
        id=d.id,
        name=d.name,
        description=d.description,
        auth_method=d.auth_method,
        enabled=d.enabled,
        is_default=d.is_default,
        default_groupname=d.default_groupname,
        deprovision_action=d.deprovision_action,
        ad_short_domain=d.ad_short_domain,
        import_mode=d.import_mode,
        sync_enabled=d.sync_enabled,
        sync_interval_minutes=d.sync_interval_minutes,
        last_sync_at=d.last_sync_at,
        last_sync_status=d.last_sync_status,
        last_sync_stats=d.last_sync_stats,
        identity_source=_source_out(source) if source else None,
        nas_group_ids=gids,
        nas_group_names=names,
        supported_protocols=sorted(adapter.capabilities(src_type, d.auth_method)),
        server_requirements=adapter.server_requirements(d.auth_method),
        created_at=d.created_at,
    )


def _reschedule_sync(d: MrAuthDomain) -> None:
    if d.enabled and d.sync_enabled and d.identity_source_id is not None:
        schedule_domain_sync(int(d.id), int(d.sync_interval_minutes))
    else:
        unschedule_domain_sync(int(d.id))


async def _clear_other_defaults(db: AsyncSession, keep_id: int) -> None:
    from sqlalchemy import update as _update

    await db.execute(
        _update(MrAuthDomain)
        .values(is_default=False)
        .where(MrAuthDomain.is_default.is_(True), MrAuthDomain.id != keep_id)
    )


def _apply_source_fields(s: MrIdentitySource, body) -> None:
    s.name = body.name
    s.source_type = body.source_type
    s.host = body.host
    s.port = body.port
    s.encryption = body.encryption
    s.base_dn = body.base_dn
    s.bind_dn = body.bind_dn
    s.tls_verify = body.tls_verify
    s.timeout = body.timeout
    s.login_attribute = body.login_attribute
    s.strip_login_suffix = body.strip_login_suffix
    s.user_search_base = body.user_search_base
    s.user_search_filter = body.user_search_filter
    if body.bind_password is not None:
        s.bind_password_enc = (
            encrypt(body.bind_password, settings.secret_key) if body.bind_password else None
        )


async def _upsert_source(db: AsyncSession, d: MrAuthDomain, body_source) -> None:
    if body_source is None:
        return
    existing = (
        await db.get(MrIdentitySource, d.identity_source_id) if d.identity_source_id else None
    )
    dup = await db.scalar(
        select(func.count())
        .select_from(MrIdentitySource)
        .where(
            MrIdentitySource.name == body_source.name,
            MrIdentitySource.id != (existing.id if existing else -1),
        )
    )
    if dup:
        raise HTTPException(409, f"Identity source '{body_source.name}' already exists")
    if existing is not None:
        _apply_source_fields(existing, body_source)
    else:
        s = MrIdentitySource()
        _apply_source_fields(s, body_source)
        db.add(s)
        await db.flush()
        d.identity_source_id = s.id


async def _set_nas_bindings(db: AsyncSession, d: MrAuthDomain, nas_group_ids: list[int]) -> None:
    await db.execute(
        delete(MrAuthDomainNasGroup).where(MrAuthDomainNasGroup.auth_domain_id == d.id)
    )
    for gid in dict.fromkeys(nas_group_ids):
        db.add(MrAuthDomainNasGroup(auth_domain_id=d.id, nas_group_id=gid))


@router.get("/auth-domains", response_model=list[AuthDomainOut])
async def list_auth_domains(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    rows = (await db.execute(select(MrAuthDomain).order_by(MrAuthDomain.name))).scalars().all()
    return [await _domain_out(d, db) for d in rows]


@router.get("/delegation-host-status", response_model=HostDelegationStatus)
async def delegation_host_status(_user=Depends(require_roles("superadmin", "admin"))):
    return await asyncio.to_thread(adapter.host_delegation_status)


@router.post("/auth-domains", response_model=AuthDomainOut, status_code=201)
async def create_auth_domain(
    body: AuthDomainCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    if await db.scalar(
        select(func.count()).select_from(MrAuthDomain).where(MrAuthDomain.name == body.name)
    ):
        raise HTTPException(409, f"Realm '{body.name}' already exists")
    d = MrAuthDomain(
        name=body.name,
        description=body.description,
        auth_method=body.auth_method,
        enabled=body.enabled,
        is_default=body.is_default,
        default_groupname=body.default_groupname,
        deprovision_action=body.deprovision_action,
        ad_short_domain=body.ad_short_domain,
        import_mode=body.import_mode,
        sync_enabled=body.sync_enabled,
        sync_interval_minutes=body.sync_interval_minutes,
    )
    db.add(d)
    await db.flush()
    await _upsert_source(db, d, body.identity_source)
    await _set_nas_bindings(db, d, body.nas_group_ids)
    if body.is_default:
        await _clear_other_defaults(db, keep_id=d.id)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.create",
        target=body.name,
        request=request,
    )
    await db.commit()
    await db.refresh(d)
    _reschedule_sync(d)
    return await _domain_out(d, db)


@router.put("/auth-domains/{domain_id}", response_model=AuthDomainOut)
async def update_auth_domain(
    domain_id: int,
    body: AuthDomainCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    d = await db.get(MrAuthDomain, domain_id)
    if not d:
        raise HTTPException(404, "Realm not found")
    if await db.scalar(
        select(func.count())
        .select_from(MrAuthDomain)
        .where(MrAuthDomain.name == body.name, MrAuthDomain.id != domain_id)
    ):
        raise HTTPException(409, f"Realm '{body.name}' already exists")
    d.name = body.name
    d.description = body.description
    d.auth_method = body.auth_method
    d.enabled = body.enabled
    d.is_default = body.is_default
    d.default_groupname = body.default_groupname
    d.deprovision_action = body.deprovision_action
    d.ad_short_domain = body.ad_short_domain
    d.import_mode = body.import_mode
    d.sync_enabled = body.sync_enabled
    d.sync_interval_minutes = body.sync_interval_minutes
    await _upsert_source(db, d, body.identity_source)
    await _set_nas_bindings(db, d, body.nas_group_ids)
    if body.is_default:
        await _clear_other_defaults(db, keep_id=d.id)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.update",
        target=d.name,
        request=request,
    )
    await db.commit()
    await db.refresh(d)
    _reschedule_sync(d)
    return await _domain_out(d, db)


@router.delete("/auth-domains/{domain_id}", status_code=204)
async def delete_auth_domain(
    domain_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    d = await db.get(MrAuthDomain, domain_id)
    if not d:
        raise HTTPException(404, "Realm not found")
    src_id = d.identity_source_id
    await db.delete(d)
    if src_id:
        src = await db.get(MrIdentitySource, src_id)
        if src:
            await db.delete(src)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.delete",
        target=d.name,
        request=request,
    )
    await db.commit()
    unschedule_domain_sync(domain_id)


@router.post("/auth-domains/{domain_id}/test", response_model=LdapTestResult)
async def test_auth_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    from datetime import datetime, timezone

    d = await db.get(MrAuthDomain, domain_id)
    if not d:
        raise HTTPException(404, "Realm not found")
    if not d.identity_source_id:
        raise HTTPException(400, "Realm has no identity source to test")
    s = await db.get(MrIdentitySource, d.identity_source_id)
    if s is None:
        raise HTTPException(404, "Identity source not found")
    password = None
    if s.bind_password_enc:
        try:
            password = decrypt(s.bind_password_enc, settings.secret_key)
        except Exception:
            raise HTTPException(500, "Failed to decrypt stored bind password")

    status, message, rtt = await asyncio.to_thread(
        ldap_probe.test_bind,
        host=s.host,
        port=s.port,
        encryption=s.encryption,
        base_dn=s.base_dn,
        bind_dn=s.bind_dn,
        bind_password=password,
        tls_verify=s.tls_verify,
        timeout=s.timeout,
    )
    now = datetime.now(tz=timezone.utc)
    s.status = status
    s.last_probe_at = now
    if status == "up":
        s.last_rtt_ms = rtt
        s.last_seen_at = now
    await db.commit()
    return LdapTestResult(status=status, message=message, rtt_ms=rtt)


@router.get("/auth-domains/{domain_id}/ad-groups", response_model=list[LdapAdGroup])
async def list_ad_groups(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    d = await db.get(MrAuthDomain, domain_id)
    if not d:
        raise HTTPException(404, "Realm not found")
    if not d.identity_source_id:
        raise HTTPException(400, "Realm has no identity source")
    s = await db.get(MrIdentitySource, d.identity_source_id)
    if s is None:
        raise HTTPException(404, "Identity source not found")
    password = None
    if s.bind_password_enc:
        try:
            password = decrypt(s.bind_password_enc, settings.secret_key)
        except Exception:
            raise HTTPException(500, "Failed to decrypt stored bind password")
    try:
        groups = await asyncio.to_thread(ldap_sync.fetch_ad_groups, s, password)
    except Exception as exc:
        raise HTTPException(502, f"Could not list directory groups: {exc}")
    return [LdapAdGroup(**g) for g in groups]




@router.get("/auth-domains/{domain_id}/import/candidates", response_model=AuthImportCandidates)
async def import_candidates(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    result = await ldap_sync.list_import_candidates(db, domain_id)
    return AuthImportCandidates(**result)


@router.post("/auth-domains/{domain_id}/import", response_model=LdapSyncResult)
async def import_selected(
    domain_id: int,
    body: AuthImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    stats = await ldap_sync.import_selected_users(db, domain_id, body.guids)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.import",
        target=str(domain_id),
        detail={k: stats[k] for k in ("created", "unchanged", "errors")},
        request=request,
    )
    await db.commit()
    return LdapSyncResult(**stats)




@router.get("/auth-domains/{domain_id}/group-map", response_model=list[LdapGroupMapOut])
async def list_group_map(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    rows = (
        (
            await db.execute(
                select(MrAuthGroupMap)
                .where(MrAuthGroupMap.auth_domain_id == domain_id)
                .order_by(MrAuthGroupMap.priority, MrAuthGroupMap.id)
            )
        )
        .scalars()
        .all()
    )
    return [LdapGroupMapOut.model_validate(m) for m in rows]


@router.post("/auth-domains/{domain_id}/group-map", response_model=LdapGroupMapOut, status_code=201)
async def create_group_map(
    domain_id: int,
    body: LdapGroupMapCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    dup = await db.scalar(
        select(func.count())
        .select_from(MrAuthGroupMap)
        .where(MrAuthGroupMap.auth_domain_id == domain_id, MrAuthGroupMap.ad_group == body.ad_group)
    )
    if dup:
        raise HTTPException(409, f"AD group '{body.ad_group}' is already mapped")
    m = MrAuthGroupMap(
        auth_domain_id=domain_id,
        ad_group=body.ad_group,
        groupname=body.groupname,
        priority=body.priority,
    )
    db.add(m)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.groupmap_create",
        target=f"{body.ad_group} → {body.groupname}",
        request=request,
    )
    await db.commit()
    await db.refresh(m)
    return LdapGroupMapOut.model_validate(m)


@router.put("/auth-domains/{domain_id}/group-map/{map_id}", response_model=LdapGroupMapOut)
async def update_group_map(
    domain_id: int,
    map_id: int,
    body: LdapGroupMapCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    m = await db.get(MrAuthGroupMap, map_id)
    if not m or m.auth_domain_id != domain_id:
        raise HTTPException(404, "Group mapping not found")
    dup = await db.scalar(
        select(func.count())
        .select_from(MrAuthGroupMap)
        .where(
            MrAuthGroupMap.auth_domain_id == domain_id,
            MrAuthGroupMap.ad_group == body.ad_group,
            MrAuthGroupMap.id != map_id,
        )
    )
    if dup:
        raise HTTPException(409, f"AD group '{body.ad_group}' is already mapped")
    m.ad_group = body.ad_group
    m.groupname = body.groupname
    m.priority = body.priority
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.groupmap_update",
        target=f"{body.ad_group} → {body.groupname}",
        request=request,
    )
    await db.commit()
    await db.refresh(m)
    return LdapGroupMapOut.model_validate(m)


@router.delete("/auth-domains/{domain_id}/group-map/{map_id}", status_code=204)
async def delete_group_map(
    domain_id: int,
    map_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    m = await db.get(MrAuthGroupMap, map_id)
    if not m or m.auth_domain_id != domain_id:
        raise HTTPException(404, "Group mapping not found")
    await db.delete(m)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.groupmap_delete",
        target=str(map_id),
        request=request,
    )
    await db.commit()




@router.get("/auth-domains/{domain_id}/sync/preview", response_model=LdapSyncResult)
async def preview_sync(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    stats = await ldap_sync.sync_auth_domain(db, domain_id, dry_run=True)
    return LdapSyncResult(**stats)


@router.post("/auth-domains/{domain_id}/sync", response_model=LdapSyncResult)
async def run_sync(
    domain_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    if not await db.get(MrAuthDomain, domain_id):
        raise HTTPException(404, "Authentication realm not found")
    stats = await ldap_sync.sync_auth_domain(db, domain_id, dry_run=False)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="authdomain.sync",
        target=str(domain_id),
        detail={k: stats[k] for k in ("created", "updated", "disabled", "removed", "errors")},
        request=request,
    )
    await db.commit()
    return LdapSyncResult(**stats)


@router.get("/auth-domains/{domain_id}/sync/runs", response_model=list[LdapSyncRun])
async def sync_runs(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    d = await db.get(MrAuthDomain, domain_id)
    if not d:
        raise HTTPException(404, "Authentication realm not found")
    from monsterops.modules.scheduler.models import ReportRun

    rows = (
        (
            await db.execute(
                select(ReportRun)
                .where(
                    ReportRun.job_type == "ldap_sync",
                    ReportRun.job_name == d.name,
                )
                .order_by(ReportRun.run_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        LdapSyncRun(run_at=r.run_at, status=r.status, data=r.data, error_message=r.error_message)
        for r in rows
    ]




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

    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="realm.proxyconf_apply",
        target=str(path),
        detail={"bytes": len(content)},
        request=request,
    )
    await db.commit()

    background.add_task(restart_freeradius)
    return ProxyConfApplyResult(
        written=True,
        path=str(path),
        bytes=len(content),
        restart_triggered=True,
    )
