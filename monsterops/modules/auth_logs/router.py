from __future__ import annotations

import asyncio
import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import and_, case, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.geo import lookup_calling_station as geo_lookup_cs
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.auth.utils import get_current_user
from monsterops.modules.auth_logs.models import Radpostauth
from monsterops.modules.auth_logs.schemas import (
    FailedLoginCount,
    GeoInfo,
    RadpostauthOut,
    TimelinePoint,
)
from monsterops.pagination import decode_cursor, encode_cursor

router = APIRouter(prefix="/api/auth-logs", tags=["auth_logs"])




def _enrich_auth_logs(
    rows: list[Radpostauth],
    sessions: list[Radacct],
) -> list[RadpostauthOut]:
    out = []
    for r in rows:
        obj = RadpostauthOut.model_validate(r)
        obj.geo_client = _geo_from_record(r.callingstationid)
        if r.username and r.authdate:
            best_id: int | None = None
            best_diff: float = 61.0
            for s in sessions:
                if s.username != r.username or not s.acctstarttime:
                    continue
                diff = abs((s.acctstarttime - r.authdate).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best_id = s.radacctid
            obj.linked_session_id = best_id
        out.append(obj)
    return out


def _geo_from_record(calling_station_id: object) -> GeoInfo | None:
    raw = geo_lookup_cs(str(calling_station_id) if calling_station_id else None)
    if not raw:
        return None
    return GeoInfo(**raw)


def _auth_log_filters(
    username: str | None,
    reply: str | None,
    from_: datetime | None,
    to_: datetime | None,
) -> list:
    filters = []
    if username:
        filters.append(Radpostauth.username == username)
    if reply:
        filters.append(Radpostauth.reply == reply)
    if from_:
        filters.append(Radpostauth.authdate >= from_)
    if to_:
        filters.append(Radpostauth.authdate <= to_)
    return filters


async def _fetch_nearby_sessions(
    db: AsyncSession, rows: list[Radpostauth]
) -> list[Radacct]:
    usernames = {r.username for r in rows if r.username}
    authdates = [r.authdate for r in rows if r.authdate]
    if not usernames or not authdates:
        return []
    t_min, t_max = min(authdates), max(authdates)
    sq = await db.execute(
        select(Radacct).where(
            and_(
                Radacct.username.in_(usernames),
                Radacct.acctstarttime >= t_min - timedelta(seconds=120),
                Radacct.acctstarttime <= t_max + timedelta(seconds=120),
            )
        )
    )
    return list(sq.scalars().all())


@router.get("", response_model=list[RadpostauthOut])
async def list_auth_logs(
    response: Response,
    username: str | None = Query(None),
    reply: str | None = Query(None),
    from_: datetime | None = Query(None, alias="from"),
    to_: datetime | None = Query(None, alias="to"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    before: str | None = Query(
        None,
        description="Keyset cursor (from a previous page's X-Next-Cursor). When set, "
        "pages via the authdate index instead of offset — O(limit) at any depth.",
    ),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    filters = _auth_log_filters(username, reply, from_, to_)

    stmt = (
        select(Radpostauth)
        .where(*filters)
        .order_by(Radpostauth.authdate.desc(), Radpostauth.id.desc())
        .limit(limit)
    )
    if before:
        try:
            bt, bid = decode_cursor(before)
        except ValueError:
            raise HTTPException(400, "invalid cursor")
        stmt = stmt.where(tuple_(Radpostauth.authdate, Radpostauth.id) < tuple_(bt, bid))
    else:
        stmt = stmt.offset(offset)

    q = await db.execute(stmt)
    rows = q.scalars().all()

    if len(rows) == limit and rows[-1].authdate is not None:
        response.headers["X-Next-Cursor"] = encode_cursor(rows[-1].authdate, rows[-1].id)

    sessions = await _fetch_nearby_sessions(db, rows)
    return _enrich_auth_logs(rows, sessions)


@router.get("/anomalies")
async def get_anomalies(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)

    multi_q = await db.execute(
        select(
            Radacct.username,
            func.count(func.distinct(func.host(Radacct.nasipaddress))).label("nas_count"),
        )
        .where(Radacct.acctstoptime.is_(None))
        .group_by(Radacct.username)
        .having(func.count(func.distinct(func.host(Radacct.nasipaddress))) > 1)
    )
    concurrent = [{"username": r.username, "nas_count": int(r.nas_count)} for r in multi_q.all()]

    off_q = await db.execute(
        select(Radpostauth)
        .where(
            and_(
                Radpostauth.authdate >= since,
                func.extract("hour", Radpostauth.authdate) < 6,
            )
        )
        .order_by(Radpostauth.authdate.desc())
        .limit(50)
    )
    off_hours_rows = off_q.scalars().all()
    off_hours = [RadpostauthOut.model_validate(r) for r in off_hours_rows]
    for obj, r in zip(off_hours, off_hours_rows):
        obj.geo_client = _geo_from_record(r.callingstationid)

    multi_loc_q = await db.execute(
        select(
            Radpostauth.username,
            func.count(func.distinct(func.host(Radpostauth.nasipaddress))).label("nas_count"),
        )
        .where(
            and_(
                Radpostauth.authdate >= since,
                Radpostauth.reply == "Access-Accept",
            )
        )
        .group_by(Radpostauth.username)
        .having(func.count(func.distinct(func.host(Radpostauth.nasipaddress))) > 1)
        .order_by(func.count(func.distinct(func.host(Radpostauth.nasipaddress))).desc())
        .limit(20)
    )
    multi_location = [
        {"username": r.username, "nas_count": int(r.nas_count)} for r in multi_loc_q.all()
    ]

    return {
        "concurrent_sessions": concurrent,
        "off_hours_events": [r.model_dump(mode="json") for r in off_hours],
        "multi_location_users": multi_location,
        "window_hours": hours,
    }




@router.get("/export")
async def export_csv(
    username: str | None = Query(None),
    reply: str | None = Query(None),
    limit: int = Query(10_000, ge=1, le=100_000),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    filters = []
    if username:
        filters.append(Radpostauth.username == username)
    if reply:
        filters.append(Radpostauth.reply == reply)

    q = await db.execute(
        select(Radpostauth).where(*filters).order_by(Radpostauth.authdate.desc()).limit(limit)
    )
    rows = q.scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Time",
            "Username",
            "Result",
            "Auth Method",
            "Failure Reason",
            "Latency (ms)",
            "Calling Station",
            "Called Station",
            "NAS IP",
            "NAS ID",
        ]
    )
    for r in rows:
        nas_ip = str(r.nasipaddress).split("/")[0] if r.nasipaddress else ""
        writer.writerow(
            [
                r.authdate.isoformat() if r.authdate else "",
                r.username or "",
                r.reply or "",
                r.authmethod or "",
                r.failurereason or "",
                r.auth_latency_ms if r.auth_latency_ms is not None else "",
                r.callingstationid or "",
                r.calledstationid or "",
                nas_ip,
                r.nasidentifier or "",
            ]
        )

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="auth-logs.csv"'},
    )




@router.get("/failed-counts", response_model=list[FailedLoginCount])
async def failed_counts(
    hours: int = Query(24, ge=1, le=720),
    min_count: int = Query(5, ge=1),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
    q = await db.execute(
        select(Radpostauth.username, func.count().label("cnt"))
        .where(
            and_(
                Radpostauth.reply == "Access-Reject",
                Radpostauth.authdate >= since,
            )
        )
        .group_by(Radpostauth.username)
        .having(func.count() >= min_count)
        .order_by(func.count().desc())
        .limit(50)
    )
    return [FailedLoginCount(username=row.username, count=row.cnt) for row in q.all()]




@router.get("/timeline", response_model=list[TimelinePoint])
async def get_timeline(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
    hour_trunc = func.date_trunc("hour", Radpostauth.authdate)

    q = await db.execute(
        select(
            hour_trunc.label("hour"),
            func.sum(case((Radpostauth.reply == "Access-Accept", 1), else_=0)).label(
                "accept_count"
            ),
            func.sum(case((Radpostauth.reply != "Access-Accept", 1), else_=0)).label(
                "reject_count"
            ),
        )
        .where(Radpostauth.authdate >= since)
        .group_by(hour_trunc)
        .order_by(hour_trunc)
    )
    return [
        TimelinePoint(hour=row.hour, accept_count=row.accept_count, reject_count=row.reject_count)
        for row in q.all()
    ]




@router.get("/{log_id}", response_model=RadpostauthOut)
async def get_auth_log(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    row = await db.get(Radpostauth, log_id)
    if not row:
        raise HTTPException(404, "Log entry not found")
    enriched = _enrich_auth_logs([row], [])
    return enriched[0]




@router.get("/{log_id}/freeradius-log")
async def get_freeradius_context(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    row = await db.get(Radpostauth, log_id)
    if not row:
        raise HTTPException(404, "Log entry not found")

    username = row.username or ""
    auth_time = row.authdate

    log_files = [p.strip() for p in settings.radius_log_files.split(",") if p.strip()]
    results = []

    for log_path_str in log_files:
        path = Path(log_path_str)
        if not path.exists():
            results.append({"file": log_path_str, "error": "File not found", "lines": []})
            continue

        try:
            proc = await asyncio.create_subprocess_exec(
                "grep",
                "-n",
                "-F",
                username,
                str(path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10.0)
            all_matches = stdout.decode(errors="replace").splitlines()

            lines = all_matches[-50:] if len(all_matches) > 50 else all_matches
            results.append(
                {
                    "file": log_path_str,
                    "total_matches": len(all_matches),
                    "lines": lines,
                    "error": None,
                }
            )
        except asyncio.TimeoutError:
            results.append({"file": log_path_str, "error": "grep timed out", "lines": []})
        except Exception as exc:
            results.append({"file": log_path_str, "error": str(exc), "lines": []})

    return {
        "log_id": log_id,
        "username": username,
        "auth_time": auth_time.isoformat() if auth_time else None,
        "log_files": results,
    }
