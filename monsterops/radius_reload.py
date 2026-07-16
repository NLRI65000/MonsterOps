
from __future__ import annotations

import asyncio
import logging
import time

logger = logging.getLogger(__name__)

_RELOAD_CMDS: list[list[str]] = [
    ["radreload"],
    ["sudo", "-n", "systemctl", "reload", "freeradius"],
    ["sudo", "-n", "systemctl", "reload", "freeradius3"],
    ["sudo", "-n", "radreload"],
]

_RESTART_CMDS: list[list[str]] = [
    ["sudo", "-n", "systemctl", "restart", "freeradius"],
    ["sudo", "-n", "systemctl", "restart", "freeradius3"],
]

_reload_lock = asyncio.Lock()
_restart_lock = asyncio.Lock()

_last_reload_at: float = 0.0
_last_restart_at: float = 0.0

_COOLDOWN = 5.0


async def _try_cmds(cmds: list[list[str]], label: str) -> bool:
    for cmd in cmds:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                logger.warning("FreeRADIUS %s via %r timed out", label, cmd)
                continue

            if proc.returncode == 0:
                logger.info("FreeRADIUS %s succeeded via %r", label, cmd)
                return True

            logger.warning(
                "FreeRADIUS %s via %r exited %d: %s",
                label,
                cmd,
                proc.returncode,
                stderr.decode().strip(),
            )
        except FileNotFoundError:
            continue
        except Exception as exc:
            logger.warning("FreeRADIUS %s via %r raised: %s", label, cmd, exc)

    logger.error(
        "FreeRADIUS %s failed — all commands exhausted. "
        "Check sudoers: monsterops needs NOPASSWD for systemctl %s freeradius",
        label,
        label,
    )
    return False


async def reload_freeradius() -> bool:
    global _last_reload_at

    if _reload_lock.locked():
        logger.debug("FreeRADIUS reload already in progress — skipping concurrent call")
        return True

    async with _reload_lock:
        now = time.monotonic()
        if now - _last_reload_at < _COOLDOWN:
            logger.debug(
                "FreeRADIUS reload skipped — last reload was %.1fs ago (cooldown %ss)",
                now - _last_reload_at,
                _COOLDOWN,
            )
            return True

        ok = await _try_cmds(_RELOAD_CMDS, "reload")
        if ok:
            _last_reload_at = time.monotonic()
        return ok


async def restart_freeradius() -> bool:
    global _last_restart_at

    if _restart_lock.locked():
        logger.debug("FreeRADIUS restart already in progress — skipping concurrent call")
        return True

    async with _restart_lock:
        now = time.monotonic()
        if now - _last_restart_at < _COOLDOWN:
            logger.debug(
                "FreeRADIUS restart skipped — last restart was %.1fs ago (cooldown %ss)",
                now - _last_restart_at,
                _COOLDOWN,
            )
            return True

        ok = await _try_cmds(_RESTART_CMDS, "restart")
        if ok:
            _last_restart_at = time.monotonic()
        return ok
