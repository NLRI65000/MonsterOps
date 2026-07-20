
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import SessionLocal
from monsterops.modules.nas.models import Nas, NasReachability

logger = logging.getLogger(__name__)

_RTT_RE = re.compile(r"time[=<]\s*([\d.]+)\s*ms")

REACHABLE = "reachable"
UNREACHABLE = "unreachable"
UNKNOWN = "unknown"
SKIPPED = "skipped"


def _probe_host(nasname: str | None) -> str | None:
    host = (nasname or "").strip()
    if not host or host == "*":
        return None
    if "/" in host:
        return None
    return host


async def _ping(host: str, timeout: int) -> tuple[str, float | None, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping",
            "-c",
            "1",
            "-w",
            str(timeout),
            "-n",
            host,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout + 2)
    except FileNotFoundError:
        return UNKNOWN, None, "ping binary not found"
    except asyncio.TimeoutError:
        return UNREACHABLE, None, "probe timed out"
    except Exception:  # noqa: BLE001 — a probe must never take the worker down
        logger.exception("ping to %s failed unexpectedly", host)
        return UNKNOWN, None, "probe error"

    if proc.returncode == 0:
        m = _RTT_RE.search(stdout.decode(errors="replace"))
        return REACHABLE, (float(m.group(1)) if m else None), ""

    err = stderr.decode(errors="replace").lower()
    if any(w in err for w in ("permitted", "capabilities", "socket")):
        return UNKNOWN, None, "ping not permitted (grant cap_net_raw on ping)"
    detail = "no ICMP reply" if proc.returncode == 1 else "host unresolved/unreachable"
    return UNREACHABLE, None, detail


async def _upsert(
    db: AsyncSession,
    nas_id: int,
    status: str,
    rtt: float | None,
    detail: str,
    now: datetime,
) -> None:
    stmt = pg_insert(NasReachability).values(
        nas_id=nas_id,
        status=status,
        method="icmp",
        last_rtt_ms=rtt,
        last_probe_at=now,
        last_seen_at=now if status == REACHABLE else None,
        detail=detail or None,
    )
    set_ = {
        "status": stmt.excluded.status,
        "method": stmt.excluded.method,
        "last_rtt_ms": stmt.excluded.last_rtt_ms,
        "last_probe_at": stmt.excluded.last_probe_at,
        "detail": stmt.excluded.detail,
    }
    if status == REACHABLE:
        set_["last_seen_at"] = stmt.excluded.last_seen_at
    await db.execute(stmt.on_conflict_do_update(index_elements=["nas_id"], set_=set_))


async def _probe_one(nas: Nas, timeout: int) -> tuple[str, float | None, str]:
    host = _probe_host(nas.nasname)
    if host is None:
        return SKIPPED, None, "not an individually pingable address"
    return await _ping(host, timeout)


async def run_nas_probe_cycle() -> int:
    timeout = max(1, int(settings.nas_probe_timeout_seconds))
    async with SessionLocal() as db:
        nas_rows = (await db.execute(select(Nas))).scalars().all()
        if not nas_rows:
            return 0

        results = await asyncio.gather(*(_probe_one(n, timeout) for n in nas_rows))
        now = datetime.now(tz=timezone.utc)
        for nas, (status, rtt, detail) in zip(nas_rows, results):
            await _upsert(db, nas.id, status, rtt, detail, now)
        await db.commit()
        return len(nas_rows)


async def probe_nas_now(nas_id: int) -> NasReachability | None:
    timeout = max(1, int(settings.nas_probe_timeout_seconds))
    async with SessionLocal() as db:
        nas = await db.scalar(select(Nas).where(Nas.id == nas_id))
        if nas is None:
            return None
        status, rtt, detail = await _probe_one(nas, timeout)
        await _upsert(db, nas_id, status, rtt, detail, datetime.now(tz=timezone.utc))
        await db.commit()
        return await db.scalar(select(NasReachability).where(NasReachability.nas_id == nas_id))


async def nas_reachability_worker() -> None:
    interval = max(10, int(settings.nas_probe_interval_seconds))
    logger.info("NAS reachability monitor started (interval %ss)", interval)
    while True:
        try:
            await run_nas_probe_cycle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("NAS reachability probe cycle failed")
        await asyncio.sleep(interval)
