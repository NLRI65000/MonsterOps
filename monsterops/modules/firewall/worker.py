from __future__ import annotations

import asyncio
import ipaddress
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from monsterops.database import SessionLocal
from monsterops.modules.firewall import nft
from monsterops.modules.firewall.models import MrFirewallSet, MrFirewallSetEntry
from monsterops.modules.firewall.service import (
    add_ban,
    get_config,
    persist_boot_ruleset,
    record_block_event,
)

logger = logging.getLogger(__name__)

REAP_INTERVAL = 30
AUTOBLOCK_INTERVAL = 60


async def run_reap_cycle() -> int:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(MrFirewallSetEntry, MrFirewallSet.name)
            .join(MrFirewallSet, MrFirewallSetEntry.set_id == MrFirewallSet.id)
            .where(MrFirewallSetEntry.expires_at.is_not(None))
            .where(MrFirewallSetEntry.expires_at <= now)
        )).all()
        if not rows:
            return 0

        cfg = await get_config(db)
        live = bool(cfg.managed) and nft.nft_available()
        for entry, set_name in rows:
            if live:
                try:
                    await nft.delete_element(set_name, entry.element)
                except Exception:  # noqa: BLE001 — never let one element stop the sweep
                    logger.debug("reaper: could not remove %s from %s",
                                 entry.element, set_name, exc_info=True)
            await db.delete(entry)
        await db.commit()

        if live:
            await persist_boot_ruleset(db)

        logger.info("Firewall reaper: expired %d ban(s)", len(rows))
        return len(rows)


async def firewall_ban_reaper() -> None:
    logger.info("Firewall ban reaper started (interval %ss)", REAP_INTERVAL)
    while True:
        try:
            await run_reap_cycle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Firewall reaper cycle failed")
        await asyncio.sleep(REAP_INTERVAL)



def _as_ip(value: str | None) -> str | None:
    if not value:
        return None
    s = value.strip()
    try:
        ip = ipaddress.ip_address(s)
    except ValueError:
        return None
    if ip.is_loopback:
        return None
    return s


async def run_autoblock_cycle() -> int:
    async with SessionLocal() as db:
        cfg = await get_config(db)
        if not cfg.autoblock_enabled:
            return 0

        threshold = int(cfg.autoblock_threshold)
        window = int(cfg.autoblock_window)
        ban_seconds = int(cfg.autoblock_ban_seconds)

        fset = (await db.execute(
            select(MrFirewallSet).options(selectinload(MrFirewallSet.entries))
            .where(MrFirewallSet.auto_ban == True)  # noqa: E712
            .order_by(MrFirewallSet.id).limit(1)
        )).scalar_one_or_none()
        if fset is None:
            return 0

        already = {e.element for e in fset.entries}

        from monsterops.modules.auth_logs.models import Radpostauth

        since = datetime.now(timezone.utc) - timedelta(minutes=window)
        rows = (await db.execute(
            select(Radpostauth.callingstationid, func.count().label("cnt"))
            .where(Radpostauth.reply == "Access-Reject")
            .where(Radpostauth.authdate >= since)
            .where(Radpostauth.callingstationid.is_not(None))
            .group_by(Radpostauth.callingstationid)
            .having(func.count() >= threshold)
        )).all()

        banned = 0
        for station, cnt in rows:
            ip = _as_ip(station)
            if ip is None or ip in already:
                continue
            try:
                reason = f"{cnt} rejects/{window}m"
                await add_ban(db, ip, ban_seconds or None, fset.name,
                              comment=f"auto-block: {reason}")
                await record_block_event(db, element=ip, set_name=fset.name,
                                         source="brute_force", reason=reason,
                                         ban_seconds=ban_seconds or None)
                already.add(ip)
                banned += 1
                logger.warning("Auto-block: banned %s (%d Access-Rejects in %dm)", ip, cnt, window)
            except Exception:  # noqa: BLE001 — one bad element must not stop the sweep
                logger.debug("auto-block: could not ban %s", ip, exc_info=True)

        if banned:
            await persist_boot_ruleset(db)
        return banned


async def brute_force_autoblock_worker() -> None:
    logger.info("Firewall auto-block worker started (interval %ss)", AUTOBLOCK_INTERVAL)
    while True:
        try:
            await run_autoblock_cycle()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Firewall auto-block cycle failed")
        await asyncio.sleep(AUTOBLOCK_INTERVAL)
