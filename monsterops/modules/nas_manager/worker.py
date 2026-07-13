from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_TICK_MINUTES = 15


async def nas_manager_sync_worker() -> None:
    logger.info("NAS Manager config-history worker started (tick: %dm)", _TICK_MINUTES)
    await asyncio.sleep(60)
    while True:
        try:
            await _run_due_fetches()
        except Exception:
            logger.exception("NAS Manager config-history cycle failed")
        await asyncio.sleep(_TICK_MINUTES * 60)


async def _run_due_fetches() -> None:
    from sqlalchemy import select

    from monsterops.config import settings
    from monsterops.database import SessionLocal
    from monsterops.modules.nas_manager.crypto import decrypt
    from monsterops.modules.nas_manager.history import apply_retention, store_version
    from monsterops.modules.nas_manager.models import MrNasManager
    from monsterops.modules.nas_manager.service import pull_config

    now = datetime.now(timezone.utc)

    async with SessionLocal() as db:
        rows = (await db.execute(
            select(MrNasManager).where(
                MrNasManager.enabled == True,          # noqa: E712
                MrNasManager.history_enabled == True,  # noqa: E712
                MrNasManager.fetch_interval_hours > 0,
            )
        )).scalars().all()

    due = []
    for nm in rows:
        interval = timedelta(hours=nm.fetch_interval_hours)
        if nm.last_fetch_at is None or (now - nm.last_fetch_at) >= interval:
            due.append(nm.id)

    for nm_id in due:
        try:
            async with SessionLocal() as db:
                nm = await db.get(MrNasManager, nm_id)
                if nm is None:
                    continue
                password = decrypt(nm.secret_enc, settings.secret_key)
                raw, err = await pull_config(nm, password)

                nm.last_fetch_at = datetime.now(timezone.utc)
                if err:
                    logger.warning("NAS Manager scheduled fetch failed for nas_id=%s: %s", nm.nas_id, err)
                    nm.test_status = "failed"
                    nm.test_error = err
                    await db.commit()
                    continue

                nm.raw_config = raw
                nm.config_pulled_at = nm.last_fetch_at
                nm.test_status = "connected"
                nm.test_error = None
                version = await store_version(db, nm, raw, source="scheduled")
                await apply_retention(db, nm)
                await db.commit()
                logger.info(
                    "NAS Manager scheduled fetch nas_id=%s: %s",
                    nm.nas_id, "new version stored" if version else "unchanged",
                )
        except Exception:
            logger.exception("NAS Manager scheduled fetch error for manager_id=%s", nm_id)
