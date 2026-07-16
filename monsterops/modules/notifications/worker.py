from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import SessionLocal
from monsterops.modules.notifications.channels import dispatch
from monsterops.modules.notifications.models import (
    NotificationChannel,
    NotificationHistory,
    NotificationRule,
)

logger = logging.getLogger(__name__)

WORKER_INTERVAL = 60




async def _eval_auth_failure(rule: NotificationRule, db: AsyncSession) -> tuple[bool, str]:
    from monsterops.modules.auth_logs.models import Radpostauth

    cfg: dict[str, Any] = rule.config or {}  # type: ignore[assignment]
    threshold = int(cfg.get("threshold", 5))
    window_minutes = int(cfg.get("window_minutes", 10))
    username_filter: str | None = cfg.get("username") or None

    since = datetime.now(tz=timezone.utc) - timedelta(minutes=window_minutes)
    filters = [Radpostauth.reply == "Access-Reject", Radpostauth.authdate >= since]
    if username_filter:
        filters.append(Radpostauth.username == username_filter)

    q = await db.execute(
        select(Radpostauth.username, func.count().label("cnt"))
        .where(and_(*filters))
        .group_by(Radpostauth.username)
        .having(func.count() >= threshold)
        .order_by(func.count().desc())
        .limit(10)
    )
    rows = q.all()
    if not rows:
        return False, ""

    lines = "\n".join(f"  {r.username}: {r.cnt} failures" for r in rows)
    scope = f"user '{username_filter}'" if username_filter else "any user"
    msg = (
        f"Auth failure threshold exceeded ({scope}):\n"
        f"  {threshold}+ rejections in the last {window_minutes} minutes\n\n"
        f"{lines}"
    )
    return True, msg


async def _eval_nas_offline(rule: NotificationRule, db: AsyncSession) -> tuple[bool, str]:
    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.nas.models import Nas

    cfg: dict[str, Any] = rule.config or {}  # type: ignore[assignment]
    idle_minutes = int(cfg.get("idle_minutes", 5))
    nas_ip_filter: str | None = cfg.get("nas_ip") or None

    since = datetime.now(tz=timezone.utc) - timedelta(minutes=idle_minutes)

    q = await db.execute(select(Nas))
    all_nas = q.scalars().all()
    if nas_ip_filter:
        all_nas = [n for n in all_nas if str(n.nasname) == nas_ip_filter]

    offline: list[str] = []
    for nas in all_nas:
        last_q = await db.execute(
            select(func.max(Radacct.acctupdatetime)).where(Radacct.nasipaddress == nas.nasname)
        )
        last_seen = last_q.scalar()
        label = str(nas.shortname or nas.nasname)
        if (
            last_seen is None
            or (
                last_seen.tzinfo is None
                and datetime.now() - last_seen > timedelta(minutes=idle_minutes)
            )
            or (last_seen.tzinfo is not None and last_seen < since)
        ):
            offline.append(label)

    if not offline:
        return False, ""

    device_list = "\n".join(f"  - {d}" for d in offline)
    msg = (
        f"NAS offline alert: {len(offline)} device(s) with no accounting "
        f"activity in the last {idle_minutes} minutes:\n\n{device_list}"
    )
    return True, msg


async def _eval_system_health(rule: NotificationRule, db: AsyncSession) -> tuple[bool, str]:
    cfg: dict[str, Any] = rule.config or {}  # type: ignore[assignment]
    check = cfg.get("check", "db")

    if check == "db":
        try:
            await db.execute(select(func.now()))
            return False, ""
        except Exception as exc:
            return True, f"Database health check failed: {exc}"

    return False, ""


_EVALUATORS = {
    "auth_failure": _eval_auth_failure,
    "nas_offline": _eval_nas_offline,
    "system_health": _eval_system_health,
}




async def _run_rule(rule: NotificationRule, db: AsyncSession) -> None:
    now = datetime.now(tz=timezone.utc)

    if rule.last_triggered:
        last: datetime = rule.last_triggered  # type: ignore[assignment]
        elapsed = (now - last).total_seconds()
        if elapsed < int(rule.cooldown_minutes) * 60:  # type: ignore[arg-type]
            return

    event_type = str(rule.event_type)
    evaluator = _EVALUATORS.get(event_type)
    if evaluator is None:
        return

    try:
        triggered, message = await evaluator(rule, db)
    except Exception:
        logger.exception("Error evaluating rule %d (%s)", rule.id, rule.name)
        return

    if not triggered:
        return

    channel: NotificationChannel | None = (
        await db.get(NotificationChannel, rule.channel_id) if rule.channel_id else None
    )
    subject = f"[MonsterOps] {rule.name}"
    status = "failed"
    error: str | None = None

    if channel and channel.enabled:
        ch_type = str(channel.type)
        ch_config: dict[str, Any] = channel.config or {}  # type: ignore[assignment]
        ok, error = await dispatch(ch_type, ch_config, subject, message)
        status = "sent" if ok else "failed"
        if not ok:
            logger.warning("Notification send failed for rule %d: %s", rule.id, error)
    else:
        error = "No channel configured" if not channel else "Channel is disabled"

    db.add(
        NotificationHistory(
            rule_id=rule.id,
            rule_name=rule.name,
            channel_id=channel.id if channel else None,
            channel_name=channel.name if channel else None,
            event_type=rule.event_type,
            subject=subject,
            message=message,
            status=status,
            error=error,
        )
    )
    rule.last_triggered = now  # type: ignore[assignment]
    await db.commit()




async def _check_once() -> None:
    async with SessionLocal() as db:
        q = await db.execute(
            select(NotificationRule).where(NotificationRule.enabled == True)  # noqa: E712
        )
        for rule in q.scalars().all():
            await _run_rule(rule, db)


async def notification_worker() -> None:
    logger.info("Notification worker started (interval=%ds)", WORKER_INTERVAL)
    while True:
        try:
            await _check_once()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Notification worker unhandled error")
        try:
            await asyncio.sleep(WORKER_INTERVAL)
        except asyncio.CancelledError:
            break
    logger.info("Notification worker stopped")
