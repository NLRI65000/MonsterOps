
from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from sqlalchemy import func, select

from monsterops.config import settings
from monsterops.database import SessionLocal

_STALE_SESSION_HOURS = 24

_EXPIRY_FORMATS = [
    "%d %b %Y %H:%M:%S",
    "%d %b %Y",
    "%b %d %Y %H:%M:%S",
    "%b %d %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
]


def _parse_radius_date(value: str) -> datetime | None:
    for fmt in _EXPIRY_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


logger = logging.getLogger(__name__)


async def run_daily_summary(job_id: int | None, job_name: str, recipients: list[str]) -> None:
    now = datetime.now(tz=timezone.utc)
    period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = period_end - timedelta(days=1)
    await _run_summary(job_id, job_name, "daily_summary", period_start, period_end, recipients)


async def run_weekly_summary(job_id: int | None, job_name: str, recipients: list[str]) -> None:
    now = datetime.now(tz=timezone.utc)
    period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = period_end - timedelta(days=7)
    await _run_summary(job_id, job_name, "weekly_summary", period_start, period_end, recipients)


async def _run_summary(
    job_id: int | None,
    job_name: str,
    job_type: str,
    period_start: datetime,
    period_end: datetime,
    recipients: list[str],
) -> None:
    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.auth_logs.models import Radpostauth
    from monsterops.modules.scheduler.models import ReportRun, SchedulerJob

    data: dict[str, Any] = {}
    error_msg: str | None = None

    try:
        async with SessionLocal() as db:
            auth_q = await db.execute(
                select(
                    func.sum(func.cast(Radpostauth.reply == "Access-Accept", func.Integer())).label(
                        "accepts"
                    ),
                    func.sum(func.cast(Radpostauth.reply != "Access-Accept", func.Integer())).label(
                        "rejects"
                    ),
                    func.count().label("total"),
                ).where(
                    Radpostauth.authdate >= period_start,
                    Radpostauth.authdate < period_end,
                )
            )
            auth_row = auth_q.one()

            sess_q = await db.execute(
                select(func.count().label("cnt")).where(
                    Radacct.acctstarttime >= period_start,
                    Radacct.acctstarttime < period_end,
                )
            )
            sess_cnt = sess_q.scalar() or 0

            top_users_q = await db.execute(
                select(Radacct.username, func.count().label("cnt"))
                .where(
                    Radacct.acctstarttime >= period_start,
                    Radacct.acctstarttime < period_end,
                    Radacct.username.isnot(None),
                )
                .group_by(Radacct.username)
                .order_by(func.count().desc())
                .limit(10)
            )
            top_users = [{"username": r.username, "sessions": r.cnt} for r in top_users_q.all()]

            data = {
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "auth_accepts": int(auth_row.accepts or 0),
                "auth_rejects": int(auth_row.rejects or 0),
                "auth_total": int(auth_row.total or 0),
                "new_sessions": int(sess_cnt),
                "top_users": top_users,
            }

            if job_id:
                job = await db.get(SchedulerJob, job_id)
                if job:
                    job.last_run_at = datetime.now(tz=timezone.utc)

            run = ReportRun(
                job_id=job_id,
                job_name=job_name,
                job_type=job_type,
                run_at=datetime.now(tz=timezone.utc),
                status="ok",
                data=data,
                emailed_to=recipients or None,
            )
            db.add(run)
            await db.commit()

    except Exception as exc:
        logger.exception("Scheduler job %s failed", job_name)
        error_msg = str(exc)
        async with SessionLocal() as db2:
            run = ReportRun(
                job_id=job_id,
                job_name=job_name,
                job_type=job_type,
                run_at=datetime.now(tz=timezone.utc),
                status="error",
                error_message=error_msg,
            )
            db2.add(run)
            await db2.commit()
        return

    if recipients and data:
        _send_email(job_name, job_type, data, recipients)


def _send_email(job_name: str, job_type: str, data: dict[str, Any], recipients: list[str]) -> None:
    host = getattr(settings, "smtp_host", "") or ""
    port = int(getattr(settings, "smtp_port", 25) or 25)
    user = getattr(settings, "smtp_user", "") or ""
    password = getattr(settings, "smtp_password", "") or ""
    from_addr = getattr(settings, "smtp_from", "") or user or "monsterops@localhost"
    use_tls = bool(getattr(settings, "smtp_tls", False))

    if not host:
        logger.info("SMTP not configured — skipping email for job %s", job_name)
        return

    label = "Daily" if job_type == "daily_summary" else "Weekly"
    subject = f"[MonsterOps] {label} Report — {data.get('period_start', '')[:10]}"

    body_lines = [
        f"<h2>MonsterOps {label} Report</h2>",
        f"<p>Period: {data['period_start'][:19]} – {data['period_end'][:19]} UTC</p>",
        "<table border='1' cellpadding='6' style='border-collapse:collapse;'>",
        "<tr><th>Metric</th><th>Value</th></tr>",
        f"<tr><td>Auth Accepts</td><td>{data['auth_accepts']}</td></tr>",
        f"<tr><td>Auth Rejects</td><td>{data['auth_rejects']}</td></tr>",
        f"<tr><td>New Sessions</td><td>{data['new_sessions']}</td></tr>",
        "</table>",
    ]
    if data.get("top_users"):
        body_lines.append("<h3>Top 10 Users</h3><ol>")
        for u in data["top_users"]:
            body_lines.append(f"<li>{u['username']} — {u['sessions']} sessions</li>")
        body_lines.append("</ol>")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText("\n".join(body_lines), "html"))

    try:
        if use_tls:
            smtp = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            smtp = smtplib.SMTP(host, port, timeout=15)
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.sendmail(from_addr, recipients, msg.as_string())
        smtp.quit()
        logger.info("Report email sent to %s for job %s", recipients, job_name)
    except Exception as exc:
        logger.error("Failed to send report email for job %s: %s", job_name, exc)




async def run_expired_user_cleanup(
    job_id: int | None, job_name: str, recipients: list[str]
) -> None:
    from monsterops.modules.scheduler.models import ReportRun, SchedulerJob
    from monsterops.modules.users.models import Radcheck

    disabled: list[str] = []
    skipped: list[str] = []
    error_msg: str | None = None

    try:
        async with SessionLocal() as db:
            now = datetime.now(tz=timezone.utc)
            expiry_rows = (
                (await db.execute(select(Radcheck).where(Radcheck.attribute == "Expiration")))
                .scalars()
                .all()
            )

            for row in expiry_rows:
                expiry_dt = _parse_radius_date(row.value)
                if expiry_dt is None:
                    skipped.append(row.username)
                    logger.warning(
                        "expired_user_cleanup: cannot parse Expiration '%s' for %s",
                        row.value,
                        row.username,
                    )
                    continue
                if expiry_dt >= now:
                    continue
                already = await db.scalar(
                    select(func.count())
                    .select_from(Radcheck)
                    .where(
                        Radcheck.username == row.username,
                        Radcheck.attribute == "Auth-Type",
                        Radcheck.value == "Reject",
                    )
                )
                if not already:
                    db.add(
                        Radcheck(
                            username=row.username, attribute="Auth-Type", op=":=", value="Reject"
                        )
                    )
                    disabled.append(row.username)

            await db.commit()

            if job_id:
                job = await db.get(SchedulerJob, job_id)
                if job:
                    job.last_run_at = now

            run = ReportRun(
                job_id=job_id,
                job_name=job_name,
                job_type="expired_user_cleanup",
                run_at=now,
                status="ok",
                data={
                    "disabled": disabled,
                    "skipped_unparseable": skipped,
                    "disabled_count": len(disabled),
                },
            )
            db.add(run)
            await db.commit()

    except Exception as exc:
        logger.exception("expired_user_cleanup job '%s' failed", job_name)
        error_msg = str(exc)
        async with SessionLocal() as db2:
            db2.add(
                ReportRun(
                    job_id=job_id,
                    job_name=job_name,
                    job_type="expired_user_cleanup",
                    run_at=datetime.now(tz=timezone.utc),
                    status="error",
                    error_message=error_msg,
                )
            )
            await db2.commit()
        return

    logger.info("expired_user_cleanup '%s': disabled %d user(s)", job_name, len(disabled))


async def run_stale_session_sweep(job_id: int | None, job_name: str, recipients: list[str]) -> None:
    from sqlalchemy import func as sqlfunc

    from monsterops.modules.accounting.models import Radacct
    from monsterops.modules.scheduler.models import ReportRun, SchedulerJob

    closed_count = 0
    error_msg: str | None = None

    try:
        async with SessionLocal() as db:
            now = datetime.now(tz=timezone.utc)
            cutoff = now - timedelta(hours=_STALE_SESSION_HOURS)

            stale = (
                (
                    await db.execute(
                        select(Radacct).where(
                            Radacct.acctstoptime.is_(None),
                            sqlfunc.coalesce(Radacct.acctupdatetime, Radacct.acctstarttime)
                            < cutoff,
                        )
                    )
                )
                .scalars()
                .all()
            )

            for s in stale:
                start = s.acctstarttime
                if start and start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                duration = max(0, int((now - start).total_seconds())) if start else 0
                s.acctstoptime = now
                s.acctsessiontime = duration
                s.acctterminatecause = "Stale-Session-Sweep"
                closed_count += 1

            await db.commit()

            if job_id:
                job = await db.get(SchedulerJob, job_id)
                if job:
                    job.last_run_at = now

            run = ReportRun(
                job_id=job_id,
                job_name=job_name,
                job_type="stale_session_sweep",
                run_at=now,
                status="ok",
                data={
                    "closed_sessions": closed_count,
                    "stale_threshold_hours": _STALE_SESSION_HOURS,
                },
            )
            db.add(run)
            await db.commit()

    except Exception as exc:
        logger.exception("stale_session_sweep job '%s' failed", job_name)
        error_msg = str(exc)
        async with SessionLocal() as db2:
            db2.add(
                ReportRun(
                    job_id=job_id,
                    job_name=job_name,
                    job_type="stale_session_sweep",
                    run_at=datetime.now(tz=timezone.utc),
                    status="error",
                    error_message=error_msg,
                )
            )
            await db2.commit()
        return

    logger.info("stale_session_sweep '%s': closed %d stale session(s)", job_name, closed_count)


async def run_log_retention(job_id: int | None, job_name: str, recipients: list[str]) -> None:
    from sqlalchemy import delete

    from monsterops.modules.auth.models import AuditLog
    from monsterops.modules.auth_logs.models import Radpostauth
    from monsterops.modules.nas_manager.models import MrNasDispatchLog
    from monsterops.modules.notifications.models import NotificationHistory
    from monsterops.modules.scheduler.models import ReportRun, SchedulerJob

    targets = [
        ("radpostauth", Radpostauth, Radpostauth.authdate, settings.retention_auth_log_days),
        ("audit_log", AuditLog, AuditLog.created_at, settings.retention_audit_log_days),
        (
            "notification_history",
            NotificationHistory,
            NotificationHistory.created_at,
            settings.retention_notification_days,
        ),
        (
            "nas_dispatch_log",
            MrNasDispatchLog,
            MrNasDispatchLog.executed_at,
            settings.retention_dispatch_log_days,
        ),
    ]

    deleted: dict[str, int] = {}
    error_msg: str | None = None
    now = datetime.now(tz=timezone.utc)

    try:
        async with SessionLocal() as db:
            for label, model, ts_col, days in targets:
                if days <= 0:
                    continue
                cutoff = now - timedelta(days=days)
                result = await db.execute(delete(model).where(ts_col < cutoff))
                deleted[label] = result.rowcount or 0
            await db.commit()

            if job_id:
                job = await db.get(SchedulerJob, job_id)
                if job:
                    job.last_run_at = now

            db.add(
                ReportRun(
                    job_id=job_id,
                    job_name=job_name,
                    job_type="log_retention",
                    run_at=now,
                    status="ok",
                    data={
                        "deleted": deleted,
                        "retention_days": {label: days for label, _, _, days in targets},
                    },
                )
            )
            await db.commit()

    except Exception as exc:
        logger.exception("log_retention job '%s' failed", job_name)
        error_msg = str(exc)
        async with SessionLocal() as db2:
            db2.add(
                ReportRun(
                    job_id=job_id,
                    job_name=job_name,
                    job_type="log_retention",
                    run_at=datetime.now(tz=timezone.utc),
                    status="error",
                    error_message=error_msg,
                )
            )
            await db2.commit()
        return

    logger.info("log_retention '%s': %s", job_name, deleted or "nothing to prune")
