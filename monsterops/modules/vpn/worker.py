
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from monsterops.database import SessionLocal
from monsterops.modules.vpn.models import VpnTunnel
from monsterops.modules.vpn.service import apply_status, get_backend

logger = logging.getLogger(__name__)

STATUS_INTERVAL = 30


async def run_status_cycle() -> int:
    async with SessionLocal() as db:
        tunnels = (await db.execute(select(VpnTunnel))).scalars().all()
        for t in tunnels:
            try:
                st = await get_backend(t.type).status(t)
            except Exception as exc:  # noqa: BLE001 — never let one tunnel stop the loop
                logger.debug("VPN status for %s failed: %s", t.name, exc)
                continue
            apply_status(t, st)
        await db.commit()
        return len(tunnels)


async def vpn_status_worker() -> None:
    logger.info("VPN status monitor started (interval %ss)", STATUS_INTERVAL)
    while True:
        try:
            await run_status_cycle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("VPN status cycle failed")
        await asyncio.sleep(STATUS_INTERVAL)
