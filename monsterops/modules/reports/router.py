from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.auth.utils import get_current_user
from monsterops.modules.auth_logs.models import Radpostauth
from monsterops.modules.nas.models import Nas

from .schemas import (
    BandwidthPoint,
    NasTraffic,
    OnlineTimeEntry,
    PeriodPoint,
    TopUser,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])

_RANGE_RE = re.compile(r"^(\d+)(h|d)$")


def _since(range_str: str) -> datetime:
    m = _RANGE_RE.match(range_str)
    if not m:
        raise HTTPException(422, "Invalid range. Use e.g. '24h', '7d', '30d'.")
    n, unit = int(m.group(1)), m.group(2)
    delta = timedelta(hours=n) if unit == "h" else timedelta(days=n)
    return datetime.now(tz=timezone.utc) - delta


def _trunc(col, bucket: str):
    return func.date_trunc(bucket, col)




@router.get("/login-frequency", response_model=list[PeriodPoint])
async def login_frequency(
    range: str = Query("7d"),
    bucket: str = Query("day", pattern="^(hour|day)$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    trunc = _trunc(Radpostauth.authdate, bucket)
    q = await db.execute(
        select(
            trunc.label("period"),
            func.sum(case((Radpostauth.reply == "Access-Accept", 1), else_=0)).label(
                "accept_count"
            ),
            func.sum(case((Radpostauth.reply != "Access-Accept", 1), else_=0)).label(
                "reject_count"
            ),
        )
        .where(Radpostauth.authdate >= since)
        .group_by(trunc)
        .order_by(trunc)
    )
    return [
        PeriodPoint(period=r.period, accept_count=r.accept_count, reject_count=r.reject_count)
        for r in q.all()
    ]




@router.get("/bandwidth", response_model=list[BandwidthPoint])
async def bandwidth_over_time(
    range: str = Query("30d"),
    bucket: str = Query("day", pattern="^(hour|day)$"),
    username: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    trunc = _trunc(Radacct.acctstarttime, bucket)
    filters = [Radacct.acctstarttime >= since]
    if username:
        filters.append(Radacct.username == username)

    q = await db.execute(
        select(
            trunc.label("period"),
            func.coalesce(func.sum(Radacct.acctinputoctets), 0).label("input_bytes"),
            func.coalesce(func.sum(Radacct.acctoutputoctets), 0).label("output_bytes"),
        )
        .where(*filters)
        .group_by(trunc)
        .order_by(trunc)
    )
    return [
        BandwidthPoint(period=r.period, input_bytes=r.input_bytes, output_bytes=r.output_bytes)
        for r in q.all()
    ]




@router.get("/top-users", response_model=list[TopUser])
async def top_users(
    range: str = Query("30d"),
    metric: str = Query("bandwidth", pattern="^(bandwidth|sessions|time)$"),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    q = await db.execute(
        select(
            Radacct.username,
            func.count().label("session_count"),
            func.coalesce(func.sum(Radacct.acctinputoctets), 0).label("input_bytes"),
            func.coalesce(func.sum(Radacct.acctoutputoctets), 0).label("output_bytes"),
            func.coalesce(func.sum(Radacct.acctsessiontime), 0).label("online_seconds"),
        )
        .where(Radacct.acctstarttime >= since, Radacct.username.isnot(None))
        .group_by(Radacct.username)
        .order_by(
            func.sum(Radacct.acctinputoctets + Radacct.acctoutputoctets).desc()
            if metric == "bandwidth"
            else (
                func.count().desc()
                if metric == "sessions"
                else func.sum(Radacct.acctsessiontime).desc()
            )
        )
        .limit(limit)
    )
    return [
        TopUser(
            username=r.username,
            session_count=r.session_count,
            input_bytes=r.input_bytes,
            output_bytes=r.output_bytes,
            online_seconds=r.online_seconds,
        )
        for r in q.all()
    ]




@router.get("/failed-trend", response_model=list[PeriodPoint])
async def failed_trend(
    range: str = Query("7d"),
    bucket: str = Query("day", pattern="^(hour|day)$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    trunc = _trunc(Radpostauth.authdate, bucket)
    q = await db.execute(
        select(trunc.label("period"), func.count().label("reject_count"))
        .where(Radpostauth.authdate >= since, Radpostauth.reply != "Access-Accept")
        .group_by(trunc)
        .order_by(trunc)
    )
    return [
        PeriodPoint(period=r.period, accept_count=0, reject_count=r.reject_count) for r in q.all()
    ]




@router.get("/nas-traffic", response_model=list[NasTraffic])
async def nas_traffic(
    range: str = Query("7d"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    q = await db.execute(
        select(
            func.host(Radacct.nasipaddress).label("nas_ip"),
            func.count().label("session_count"),
            func.coalesce(func.sum(Radacct.acctinputoctets), 0).label("input_bytes"),
            func.coalesce(func.sum(Radacct.acctoutputoctets), 0).label("output_bytes"),
        )
        .where(Radacct.acctstarttime >= since)
        .group_by(func.host(Radacct.nasipaddress))
        .order_by(func.sum(Radacct.acctinputoctets + Radacct.acctoutputoctets).desc())
    )
    rows = q.all()

    ips = [r.nas_ip for r in rows if r.nas_ip]
    nas_map: dict[str, str] = {}
    if ips:
        nq = await db.execute(select(Nas.nasname, Nas.shortname).where(Nas.nasname.in_(ips)))
        nas_map = {r.nasname: r.shortname for r in nq.all()}

    return [
        NasTraffic(
            nas_ip=r.nas_ip or "unknown",
            nas_name=nas_map.get(r.nas_ip),
            input_bytes=r.input_bytes,
            output_bytes=r.output_bytes,
            session_count=r.session_count,
        )
        for r in rows
    ]




@router.get("/online-time", response_model=list[OnlineTimeEntry])
async def online_time(
    range: str = Query("30d"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = _since(range)
    q = await db.execute(
        select(
            Radacct.username,
            func.coalesce(func.sum(Radacct.acctsessiontime), 0).label("total_seconds"),
            func.count().label("session_count"),
        )
        .where(Radacct.acctstarttime >= since, Radacct.username.isnot(None))
        .group_by(Radacct.username)
        .order_by(func.sum(Radacct.acctsessiontime).desc())
        .limit(limit)
    )
    return [
        OnlineTimeEntry(
            username=r.username, total_seconds=r.total_seconds, session_count=r.session_count
        )
        for r in q.all()
    ]




@router.get("/export")
async def export_report(
    report: str = Query(
        ..., pattern="^(login-frequency|bandwidth|top-users|failed-trend|nas-traffic|online-time)$"
    ),
    range: str = Query("30d"),
    bucket: str = Query("day", pattern="^(hour|day)$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    buf = io.StringIO()
    writer = csv.writer(buf)

    if report == "login-frequency":
        data = await login_frequency(range=range, bucket=bucket, db=db, _user=_user)
        writer.writerow(["Period", "Accepts", "Rejects"])
        for r in data:
            writer.writerow([r.period.isoformat(), r.accept_count, r.reject_count])

    elif report == "bandwidth":
        data = await bandwidth_over_time(range=range, bucket=bucket, db=db, _user=_user)
        writer.writerow(["Period", "Input Bytes", "Output Bytes"])
        for r in data:
            writer.writerow([r.period.isoformat(), r.input_bytes, r.output_bytes])

    elif report == "top-users":
        data = await top_users(range=range, metric="bandwidth", limit=50, db=db, _user=_user)
        writer.writerow(["Username", "Sessions", "Input Bytes", "Output Bytes", "Online Seconds"])
        for r in data:
            writer.writerow(
                [r.username, r.session_count, r.input_bytes, r.output_bytes, r.online_seconds]
            )

    elif report == "failed-trend":
        data = await failed_trend(range=range, bucket=bucket, db=db, _user=_user)
        writer.writerow(["Period", "Failed Logins"])
        for r in data:
            writer.writerow([r.period.isoformat(), r.reject_count])

    elif report == "nas-traffic":
        data = await nas_traffic(range=range, db=db, _user=_user)
        writer.writerow(["NAS IP", "NAS Name", "Sessions", "Input Bytes", "Output Bytes"])
        for r in data:
            writer.writerow(
                [r.nas_ip, r.nas_name or "", r.session_count, r.input_bytes, r.output_bytes]
            )

    elif report == "online-time":
        data = await online_time(range=range, limit=100, db=db, _user=_user)
        writer.writerow(["Username", "Total Seconds", "Sessions"])
        for r in data:
            writer.writerow([r.username, r.total_seconds, r.session_count])

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{report}-{range}.csv"'},
    )
