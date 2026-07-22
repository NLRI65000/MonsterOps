from __future__ import annotations

import asyncio
import csv
import io
import json
from collections.abc import AsyncGenerator, Sequence
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import and_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import SessionLocal, get_db
from monsterops.geo import lookup_calling_station as geo_lookup_cs
from monsterops.modules.accounting.coa import send_coa, send_disconnect
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.accounting.schemas import CoABody, CoAResult, RadacctOut
from monsterops.modules.auth.utils import get_current_user, require_roles
from monsterops.modules.auth_logs.models import Radpostauth
from monsterops.modules.auth_logs.schemas import GeoInfo
from monsterops.modules.nas.models import Nas
from monsterops.pagination import decode_cursor, encode_cursor

router = APIRouter(prefix="/api/accounting", tags=["accounting"])


def _enrich_sessions(
    rows: Sequence[Radacct], auth_events: Sequence[Radpostauth]
) -> list[RadacctOut]:
    result = []
    for r in rows:
        obj = RadacctOut.model_validate(r)
        obj.active = r.acctstoptime is None
        raw = geo_lookup_cs(r.callingstationid)
        obj.geo_client = GeoInfo(**raw) if raw else None
        if r.username and r.acctstarttime:
            best_id: int | None = None
            best_reply: str | None = None
            best_diff: float = 61.0
            for ae in auth_events:
                if ae.username != r.username or not ae.authdate:
                    continue
                diff = abs((ae.authdate - r.acctstarttime).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best_id = ae.id
                    best_reply = ae.reply
            obj.auth_log_id = best_id
            obj.auth_outcome = best_reply
        result.append(obj)
    return result




@router.get("", response_model=list[RadacctOut])
async def list_sessions(
    response: Response,
    username: str | None = Query(None),
    active_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    before: str | None = Query(
        None,
        description="Keyset cursor (from a previous page's X-Next-Cursor). When set, "
        "pages via the timestamp index instead of offset — O(limit) at any depth.",
    ),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    filters = []
    if username:
        filters.append(Radacct.username == username)
    if active_only:
        filters.append(Radacct.acctstoptime.is_(None))

    stmt = (
        select(Radacct)
        .where(*filters)
        .order_by(Radacct.acctstarttime.desc(), Radacct.radacctid.desc())
        .limit(limit)
    )
    if before:
        try:
            bt, bid = decode_cursor(before)
        except ValueError:
            raise HTTPException(400, "invalid cursor")
        stmt = stmt.where(tuple_(Radacct.acctstarttime, Radacct.radacctid) < tuple_(bt, bid))
    else:
        stmt = stmt.offset(offset)

    q = await db.execute(stmt)
    rows = q.scalars().all()

    if len(rows) == limit and rows[-1].acctstarttime is not None:
        response.headers["X-Next-Cursor"] = encode_cursor(
            rows[-1].acctstarttime, rows[-1].radacctid
        )

    auth_events: Sequence[Radpostauth] = []
    if rows:
        usernames = {r.username for r in rows if r.username}
        t_min = min((r.acctstarttime for r in rows if r.acctstarttime), default=None)
        t_max = max((r.acctstarttime for r in rows if r.acctstarttime), default=None)
        if t_min and t_max and usernames:
            aq = await db.execute(
                select(Radpostauth).where(
                    and_(
                        Radpostauth.username.in_(usernames),
                        Radpostauth.authdate >= t_min - timedelta(seconds=120),
                        Radpostauth.authdate <= t_max + timedelta(seconds=120),
                    )
                )
            )
            auth_events = aq.scalars().all()

    return _enrich_sessions(rows, auth_events)




@router.get("/stream")
async def stream_sessions(_user=Depends(get_current_user)):

    async def _generate() -> AsyncGenerator[bytes, None]:
        while True:
            try:
                async with SessionLocal() as db:
                    q = await db.execute(
                        select(Radacct)
                        .where(Radacct.acctstoptime.is_(None))
                        .order_by(Radacct.acctstarttime.desc())
                        .limit(200)
                    )
                    rows = q.scalars().all()
                    payload = []
                    for r in rows:
                        obj = RadacctOut.model_validate(r)
                        obj.active = True
                        payload.append(obj.model_dump(mode="json"))
                yield f"data: {json.dumps(payload)}\n\n".encode()
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(5)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



_CSV_HEADER = [
    "Session ID",
    "Unique ID",
    "Username",
    "NAS IP",
    "NAS Port",
    "Port Type",
    "Start",
    "Stop",
    "Duration (s)",
    "Input Octets",
    "Output Octets",
    "Framed IP",
    "Calling Station",
    "Called Station",
    "Terminate Cause",
    "Active",
]


def _csv_text(value: object) -> object:
    return value or ""


def _csv_ip(value: object) -> str:
    return str(value).split("/")[0] if value else ""


def _csv_iso(value) -> str:
    return value.isoformat() if value else ""


def _session_csv_row(r: Radacct) -> list:
    return [
        r.acctsessionid,
        r.acctuniqueid,
        _csv_text(r.username),
        _csv_ip(r.nasipaddress),
        _csv_text(r.nasportid),
        _csv_text(r.nasporttype),
        _csv_iso(r.acctstarttime),
        _csv_iso(r.acctstoptime),
        _csv_text(r.acctsessiontime),
        r.acctinputoctets or 0,
        r.acctoutputoctets or 0,
        _csv_ip(r.framedipaddress),
        _csv_text(r.callingstationid),
        _csv_text(r.calledstationid),
        _csv_text(r.acctterminatecause),
        "yes" if r.acctstoptime is None else "no",
    ]


@router.get("/export")
async def export_csv(
    username: str | None = Query(None),
    active_only: bool = Query(False),
    limit: int = Query(10_000, ge=1, le=100_000),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    filters = []
    if username:
        filters.append(Radacct.username == username)
    if active_only:
        filters.append(Radacct.acctstoptime.is_(None))

    q = await db.execute(
        select(Radacct).where(*filters).order_by(Radacct.acctstarttime.desc()).limit(limit)
    )
    rows = q.scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_HEADER)
    for r in rows:
        writer.writerow(_session_csv_row(r))

    filename = "sessions-active.csv" if active_only else "sessions.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )




async def _resolve_session_and_nas(acctuniqueid: str, db: AsyncSession) -> tuple[Radacct, Nas]:
    sess_q = await db.execute(
        select(Radacct).where(
            Radacct.acctuniqueid == acctuniqueid,
            Radacct.acctstoptime.is_(None),
        )
    )
    session = sess_q.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Active session not found — it may have already ended")

    nas_ip = str(session.nasipaddress).split("/")[0]
    nas_q = await db.execute(select(Nas).where(Nas.nasname == nas_ip))
    nas = nas_q.scalar_one_or_none()
    if not nas:
        raise HTTPException(
            400,
            f"NAS {nas_ip} is not in the NAS list — add it first so the RADIUS secret is known",
        )

    return session, nas




@router.post("/{acctuniqueid}/disconnect", response_model=CoAResult)
async def disconnect_session(
    acctuniqueid: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    session, nas = await _resolve_session_and_nas(acctuniqueid, db)
    nas_ip = str(session.nasipaddress).split("/")[0]

    result = await send_disconnect(
        nas_ip=nas_ip,
        secret=nas.secret,
        username=session.username or "",
        session_id=session.acctsessionid,
        calling_station=session.callingstationid or None,
    )
    return CoAResult(**result)




@router.post("/{acctuniqueid}/coa", response_model=CoAResult)
async def coa_session(
    acctuniqueid: str,
    body: CoABody,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    if not body.attributes:
        raise HTTPException(422, "At least one attribute is required")

    session, nas = await _resolve_session_and_nas(acctuniqueid, db)
    nas_ip = str(session.nasipaddress).split("/")[0]

    result = await send_coa(
        nas_ip=nas_ip,
        secret=nas.secret,
        username=session.username or "",
        session_id=session.acctsessionid,
        attributes=body.attributes,
        calling_station=session.callingstationid or None,
    )
    return CoAResult(**result)
