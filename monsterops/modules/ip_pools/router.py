from __future__ import annotations

import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import get_current_user, require_roles
from monsterops.modules.ip_pools.models import Radippool
from monsterops.modules.ip_pools.schemas import (
    PoolAddIPsBody,
    PoolCreateBody,
    PoolEntry,
    PoolRenameBody,
    PoolSummary,
)

router = APIRouter(prefix="/api/ip-pools", tags=["ip_pools"])

MAX_IPS_PER_OP = 65_536


def _expand_ips(cidr: str | None, start_ip: str | None, end_ip: str | None) -> list[str]:
    if cidr:
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError as exc:
            raise HTTPException(422, f"Invalid CIDR: {exc}") from exc
        hosts = list(net.hosts()) if net.prefixlen < 31 else list(net)
        if len(hosts) > MAX_IPS_PER_OP:
            raise HTTPException(422, f"CIDR expands to {len(hosts)} IPs; max is {MAX_IPS_PER_OP}")
        return [str(ip) for ip in hosts]

    if start_ip and end_ip:
        try:
            start = ipaddress.ip_address(start_ip)
            end = ipaddress.ip_address(end_ip)
        except ValueError as exc:
            raise HTTPException(422, f"Invalid IP: {exc}") from exc
        if start > end:
            raise HTTPException(422, "start_ip must be ≤ end_ip")
        count = int(end) - int(start) + 1
        if count > MAX_IPS_PER_OP:
            raise HTTPException(422, f"Range contains {count} IPs; max is {MAX_IPS_PER_OP}")
        return [str(ipaddress.ip_address(int(start) + i)) for i in range(count)]

    raise HTTPException(422, "Provide either cidr or both start_ip and end_ip")


def _blank_entry(pool_name: str, ip: str) -> Radippool:
    return Radippool(
        pool_name=pool_name,
        framedipaddress=ip,
        nasipaddress="0.0.0.0",
        username="",
        pool_key="",
        calledstationid="",
        callingstationid="",
        expiry_time=None,
    )



@router.get("", response_model=list[PoolSummary])
async def list_pools(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = await db.execute(
        select(
            Radippool.pool_name,
            func.count().label("total"),
            func.sum(case((Radippool.username != "", 1), else_=0)).label("assigned"),
        )
        .group_by(Radippool.pool_name)
        .order_by(Radippool.pool_name)
    )
    return [
        PoolSummary(
            pool_name=row.pool_name,
            total=row.total,
            assigned=int(row.assigned or 0),
            free=row.total - int(row.assigned or 0),
        )
        for row in q.all()
    ]



@router.get("/{pool_name}/entries", response_model=list[PoolEntry])
async def list_pool_entries(
    pool_name: str,
    status: str = Query("all"),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    filters = [Radippool.pool_name == pool_name]
    if status == "assigned":
        filters.append(Radippool.username != "")
    elif status == "free":
        filters.append(Radippool.username == "")

    q = await db.execute(
        select(Radippool)
        .where(*filters)
        .order_by(Radippool.framedipaddress)
        .limit(limit)
        .offset(offset)
    )
    return [PoolEntry.model_validate(r) for r in q.scalars().all()]



@router.post("", status_code=201)
async def create_pool(
    body: PoolCreateBody,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    existing = await db.execute(
        select(func.count()).select_from(Radippool).where(Radippool.pool_name == body.pool_name)
    )
    if existing.scalar_one():
        raise HTTPException(409, f"Pool '{body.pool_name}' already exists")

    ips = _expand_ips(body.cidr, body.start_ip, body.end_ip)
    db.add_all([_blank_entry(body.pool_name, ip) for ip in ips])
    await db.commit()
    return {"pool_name": body.pool_name, "ips_added": len(ips)}



@router.post("/{pool_name}/ips", status_code=201)
async def add_ips(
    pool_name: str,
    body: PoolAddIPsBody,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    check = await db.execute(
        select(func.count()).select_from(Radippool).where(Radippool.pool_name == pool_name)
    )
    if not check.scalar_one():
        raise HTTPException(404, f"Pool '{pool_name}' not found")

    ips = _expand_ips(body.cidr, body.start_ip, body.end_ip)

    existing_q = await db.execute(
        select(func.host(Radippool.framedipaddress)).where(Radippool.pool_name == pool_name)
    )
    existing = {row[0] for row in existing_q.all()}
    new_ips = [ip for ip in ips if ip not in existing]

    if new_ips:
        db.add_all([_blank_entry(pool_name, ip) for ip in new_ips])
        await db.commit()

    return {"pool_name": pool_name, "ips_added": len(new_ips), "skipped": len(ips) - len(new_ips)}



@router.patch("/{pool_name}")
async def rename_pool(
    pool_name: str,
    body: PoolRenameBody,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    check = await db.execute(
        select(func.count()).select_from(Radippool).where(Radippool.pool_name == pool_name)
    )
    if not check.scalar_one():
        raise HTTPException(404, f"Pool '{pool_name}' not found")

    if body.new_name != pool_name:
        conflict = await db.execute(
            select(func.count()).select_from(Radippool).where(Radippool.pool_name == body.new_name)
        )
        if conflict.scalar_one():
            raise HTTPException(409, f"Pool '{body.new_name}' already exists")

    await db.execute(
        update(Radippool).where(Radippool.pool_name == pool_name).values(pool_name=body.new_name)
    )
    await db.commit()
    return {"pool_name": body.new_name}



@router.delete("/{pool_name}", status_code=204)
async def delete_pool(
    pool_name: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    result = await db.execute(delete(Radippool).where(Radippool.pool_name == pool_name))
    if result.rowcount == 0:
        raise HTTPException(404, f"Pool '{pool_name}' not found")
    await db.commit()



@router.delete("/{pool_name}/entries/{entry_id}", status_code=204)
async def remove_ip(
    pool_name: str,
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    result = await db.execute(
        delete(Radippool).where(Radippool.id == entry_id, Radippool.pool_name == pool_name)
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Entry not found")
    await db.commit()



@router.post("/{pool_name}/entries/{entry_id}/release")
async def release_ip(
    pool_name: str,
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    result = await db.execute(
        update(Radippool)
        .where(Radippool.id == entry_id, Radippool.pool_name == pool_name)
        .values(
            username="",
            pool_key="",
            nasipaddress="0.0.0.0",
            calledstationid="",
            callingstationid="",
            expiry_time=None,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Entry not found")
    await db.commit()
    return {"released": True}
