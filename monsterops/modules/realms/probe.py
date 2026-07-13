from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from pyrad import client, dictionary, packet
from sqlalchemy import select

from monsterops.database import SessionLocal
from monsterops.modules.realms.models import HomeServer

logger = logging.getLogger(__name__)

PROBE_INTERVAL = 30
PROBE_TIMEOUT = 3

_DICT_PATH = os.path.join(os.path.dirname(__file__), "radius.dict")
_DICT = dictionary.Dictionary(_DICT_PATH)
_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="realm-probe")

_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


def _probe_sync(host: str, port: int, secret: str) -> tuple[str, float | None]:
    try:
        c = client.Client(server=host, authport=port, secret=secret.encode(), dict=_DICT)
        c.timeout = PROBE_TIMEOUT
        c.retries = 1
        pkt = c.CreateAuthPacket(code=packet.StatusServer)
        pkt["NAS-Identifier"] = "monsterops-probe"
        pkt.add_message_authenticator()
        t0 = time.monotonic()
        c.SendPacket(pkt)
        return "up", round((time.monotonic() - t0) * 1000, 1)
    except client.Timeout:
        return "timeout", None
    except OSError:
        return "unreachable", None
    except Exception:  # noqa: BLE001 — a probe must never take the worker down
        logger.exception("Status-Server probe to %s:%s failed unexpectedly", host, port)
        return "unreachable", None


async def probe_server(host: str, port: int, secret: str) -> tuple[str, float | None]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_EXECUTOR, _probe_sync, host, port, secret)


async def check_interface_up(name: str) -> bool | None:
    if not _IFACE_RE.match(name):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "link", "show", "dev", name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        if proc.returncode != 0:
            return False
        out = stdout.decode(errors="replace")
        flags = out.split("<", 1)[-1].split(">", 1)[0].split(",") if "<" in out else []
        return "UP" in flags
    except Exception:  # noqa: BLE001
        return None


async def run_probe_cycle() -> int:
    async with SessionLocal() as db:
        servers = (await db.execute(select(HomeServer))).scalars().all()
        if not servers:
            return 0

        results = await asyncio.gather(
            *(probe_server(s.host, s.auth_port if s.type != "acct" else s.acct_port, s.secret)
              for s in servers)
        )

        now = datetime.now(tz=timezone.utc)
        for s, (status, rtt) in zip(servers, results):
            s.status = status
            s.last_rtt_ms = rtt
            s.last_probe_at = now
            if status == "up":
                s.last_seen_at = now
        await db.commit()
        return len(servers)


async def realm_probe_worker() -> None:
    logger.info("Realm health monitor started (interval %ss)", PROBE_INTERVAL)
    while True:
        try:
            await run_probe_cycle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Realm probe cycle failed")
        await asyncio.sleep(PROBE_INTERVAL)
