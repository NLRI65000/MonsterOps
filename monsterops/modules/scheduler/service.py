
from __future__ import annotations

import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


def _job_id(db_id: int) -> str:
    return f"mr_job_{db_id}"


def job_fn_for(job_type: str):
    from monsterops.modules.scheduler.jobs import (
        run_daily_summary,
        run_expired_user_cleanup,
        run_log_retention,
        run_stale_session_sweep,
        run_weekly_summary,
    )

    return {
        "daily_summary": run_daily_summary,
        "weekly_summary": run_weekly_summary,
        "expired_user_cleanup": run_expired_user_cleanup,
        "stale_session_sweep": run_stale_session_sweep,
        "log_retention": run_log_retention,
    }.get(job_type, run_daily_summary)


def schedule_job(
    job_id: int,
    job_type: str,
    cron_hour: int,
    cron_minute: int,
    cron_weekday: int | None,
    job_name: str,
    recipients: list[str],
) -> None:
    sched = get_scheduler()
    jid = _job_id(job_id)
    fn = job_fn_for(job_type)

    dow = str(cron_weekday) if cron_weekday is not None else "*"
    trigger = CronTrigger(hour=cron_hour, minute=cron_minute, day_of_week=dow, timezone="UTC")

    if sched.get_job(jid):
        sched.reschedule_job(jid, trigger=trigger)
    else:
        sched.add_job(
            lambda: asyncio.ensure_future(fn(job_id, job_name, recipients)),
            trigger=trigger,
            id=jid,
            name=job_name,
            replace_existing=True,
            misfire_grace_time=3600,
        )
    logger.info(
        "Scheduled job %s (%s) at %02d:%02d dow=%s", job_name, job_type, cron_hour, cron_minute, dow
    )


def unschedule_job(job_id: int) -> None:
    sched = get_scheduler()
    jid = _job_id(job_id)
    if sched.get_job(jid):
        sched.remove_job(jid)


async def load_jobs_from_db() -> None:
    from sqlalchemy import select

    from monsterops.database import SessionLocal
    from monsterops.modules.scheduler.models import SchedulerJob

    try:
        async with SessionLocal() as db:
            rows = (
                (await db.execute(select(SchedulerJob).where(SchedulerJob.enabled.is_(True))))
                .scalars()
                .all()
            )
            for row in rows:
                schedule_job(
                    job_id=row.id,
                    job_type=str(row.job_type),
                    cron_hour=int(row.cron_hour),
                    cron_minute=int(row.cron_minute),
                    cron_weekday=row.cron_weekday,
                    job_name=str(row.name),
                    recipients=list(row.recipients or []),
                )
        logger.info("Loaded %d scheduler jobs from DB", len(rows))
    except Exception as exc:
        logger.error("Failed to load scheduler jobs: %s", exc)




def _sync_job_id(auth_domain_id: int) -> str:
    return f"mr_ldap_sync_{auth_domain_id}"


def schedule_domain_sync(auth_domain_id: int, interval_minutes: int) -> None:
    from monsterops.modules.realms.ldap_sync import run_scheduled_sync

    sched = get_scheduler()
    jid = _sync_job_id(auth_domain_id)
    trigger = IntervalTrigger(minutes=max(1, int(interval_minutes)))
    if sched.get_job(jid):
        sched.reschedule_job(jid, trigger=trigger)
    else:
        sched.add_job(
            lambda: asyncio.ensure_future(run_scheduled_sync(auth_domain_id)),
            trigger=trigger,
            id=jid,
            name=f"realm_sync_{auth_domain_id}",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=3600,
        )
    logger.info("Scheduled realm sync for %s every %d min", auth_domain_id, interval_minutes)


def unschedule_domain_sync(auth_domain_id: int) -> None:
    sched = get_scheduler()
    jid = _sync_job_id(auth_domain_id)
    if sched.get_job(jid):
        sched.remove_job(jid)


async def load_domain_syncs_from_db() -> None:
    from sqlalchemy import select

    from monsterops.database import SessionLocal
    from monsterops.modules.realms.models import MrAuthDomain

    try:
        async with SessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(MrAuthDomain).where(
                            MrAuthDomain.enabled.is_(True),
                            MrAuthDomain.sync_enabled.is_(True),
                            MrAuthDomain.identity_source_id.isnot(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for d in rows:
                schedule_domain_sync(int(d.id), int(d.sync_interval_minutes))
        logger.info("Loaded %d realm sync jobs from DB", len(rows))
    except Exception as exc:
        logger.error("Failed to load realm sync jobs: %s", exc)
