from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.geo import lookup_calling_station as geo_lookup_cs
from monsterops.modules.auth.utils import get_current_user
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.auth_logs.models import Radpostauth
from monsterops.modules.auth_logs.schemas import GeoInfo
from monsterops.modules.nas.models import Nas
from monsterops.modules.users.models import Radcheck
from .schemas import DashboardStats, RecentAuth, TopUser, OnlineUser, NasStatus, SessionType

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

RangeT = Literal["today", "7d", "30d"]


def _since(range_: RangeT) -> datetime:
    now = datetime.now(timezone.utc)
    if range_ == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if range_ == "7d":
        return now - timedelta(days=7)
    return now - timedelta(days=30)


@router.get("/stats", response_model=DashboardStats)
async def get_stats(
    range: RangeT = Query("today"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)

    active_q = await db.execute(
        select(func.count()).select_from(Radacct).where(Radacct.acctstoptime.is_(None))
    )
    active_sessions = active_q.scalar_one() or 0

    auth_since = Radpostauth.authdate >= since

    logins_q = await db.execute(
        select(func.count()).select_from(Radpostauth).where(
            and_(auth_since, Radpostauth.reply == "Access-Accept")
        )
    )
    logins = logins_q.scalar_one() or 0

    failed_q = await db.execute(
        select(func.count()).select_from(Radpostauth).where(
            and_(auth_since, Radpostauth.reply == "Access-Reject")
        )
    )
    failed_logins = failed_q.scalar_one() or 0

    bw_q = await db.execute(
        select(
            func.coalesce(func.sum(Radacct.acctinputoctets), 0),
            func.coalesce(func.sum(Radacct.acctoutputoctets), 0),
        ).where(Radacct.acctstarttime >= since)
    )
    bw_row = bw_q.one()
    bytes_in = int(bw_row[0])
    bytes_out = int(bw_row[1])

    user_q = await db.execute(
        select(func.count(func.distinct(Radcheck.username)))
    )
    user_count = user_q.scalar_one() or 0

    nas_q = await db.execute(select(func.count()).select_from(Nas))
    nas_count = nas_q.scalar_one() or 0

    recent_q = await db.execute(
        select(Radpostauth)
        .order_by(Radpostauth.authdate.desc())
        .limit(20)
    )
    recent_rows = recent_q.scalars().all()
    recent_auth = [
        RecentAuth(
            username=r.username,
            reply=r.reply,
            authdate=r.authdate,
            callingstationid=r.callingstationid,
            calledstationid=r.calledstationid,
        )
        for r in recent_rows
    ]

    top_q = await db.execute(
        select(
            Radacct.username,
            func.coalesce(func.sum(Radacct.acctinputoctets), 0).label("bytes_in"),
            func.coalesce(func.sum(Radacct.acctoutputoctets), 0).label("bytes_out"),
        )
        .where(Radacct.acctstarttime >= since)
        .group_by(Radacct.username)
        .order_by(
            (func.coalesce(func.sum(Radacct.acctinputoctets), 0) +
             func.coalesce(func.sum(Radacct.acctoutputoctets), 0)).desc()
        )
        .limit(5)
    )
    top_bandwidth = [
        TopUser(
            username=row.username,
            bytes_in=int(row.bytes_in),
            bytes_out=int(row.bytes_out),
            total_bytes=int(row.bytes_in) + int(row.bytes_out),
        )
        for row in top_q.all()
    ]

    return DashboardStats(
        range=range,
        active_sessions=active_sessions,
        logins=logins,
        failed_logins=failed_logins,
        bytes_in=bytes_in,
        bytes_out=bytes_out,
        user_count=user_count,
        nas_count=nas_count,
        recent_auth=recent_auth,
        top_bandwidth=top_bandwidth,
    )


@router.get("/online-users", response_model=list[OnlineUser])
async def get_online_users(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = await db.execute(
        select(
            Radacct.username,
            Radacct.nasipaddress,
            Radacct.acctstarttime,
            Radacct.framedipaddress,
            Radacct.callingstationid,
            Nas.shortname.label("nasname"),
        )
        .outerjoin(Nas, func.host(Radacct.nasipaddress) == Nas.nasname)
        .where(Radacct.acctstoptime.is_(None))
        .order_by(Radacct.acctstarttime.desc())
        .limit(50)
    )
    result = []
    for r in q.all():
        nas_ip = str(r.nasipaddress).split('/')[0] if r.nasipaddress else None
        raw_geo = geo_lookup_cs(r.callingstationid)
        result.append(OnlineUser(
            username=r.username or "",
            nasipaddress=nas_ip,
            nasname=r.nasname,
            acctstarttime=r.acctstarttime,
            framedipaddress=str(r.framedipaddress).split('/')[0] if r.framedipaddress else None,
            callingstationid=r.callingstationid,
            geo_client=GeoInfo(**raw_geo) if raw_geo else None,
        ))
    return result


@router.get("/nas-status", response_model=list[NasStatus])
async def get_nas_status(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    fifteen_min_ago = datetime.now(timezone.utc) - timedelta(minutes=15)

    active_q = await db.execute(
        select(
            func.host(Radacct.nasipaddress).label("nasip"),
            func.count().label("cnt"),
        )
        .where(Radacct.acctstoptime.is_(None))
        .group_by(func.host(Radacct.nasipaddress))
    )
    active_counts: dict[str, int] = {row.nasip: row.cnt for row in active_q.all()}

    recent_q = await db.execute(
        select(func.host(Radacct.nasipaddress).label("nasip"))
        .where(
            or_(
                Radacct.acctupdatetime >= fifteen_min_ago,
                Radacct.acctstarttime >= fifteen_min_ago,
            )
        )
        .distinct()
    )
    recent_ips: set[str] = {row.nasip for row in recent_q.all()}

    nas_q = await db.execute(select(Nas).order_by(Nas.shortname))
    all_nas = nas_q.scalars().all()

    result = []
    for n in all_nas:
        session_count = active_counts.get(n.nasname, 0)
        online = session_count > 0 or n.nasname in recent_ips
        result.append(NasStatus(
            id=n.id,
            shortname=n.shortname or n.nasname,
            nasname=n.nasname,
            type=n.type or "other",
            online=online,
            session_count=session_count,
        ))
    return result


@router.get("/session-types", response_model=list[SessionType])
async def get_session_types(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = await db.execute(
        select(
            Radacct.nasporttype.label("porttype"),
            func.count().label("count"),
        )
        .where(Radacct.acctstoptime.is_(None))
        .group_by(Radacct.nasporttype)
        .order_by(func.count().desc())
    )
    return [SessionType(porttype=row.porttype or "Unknown", count=row.count) for row in q.all()]
