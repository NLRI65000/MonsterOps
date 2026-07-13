from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Integer, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from monsterops.database import Base


class SchedulerJob(Base):
    __tablename__ = "mr_scheduler_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False, unique=True)
    job_type = Column(Text, nullable=False)
    cron_hour = Column(Integer, nullable=False, default=0)
    cron_minute = Column(Integer, nullable=False, default=0)
    cron_weekday = Column(Integer, nullable=True)
    recipients = Column(ARRAY(Text), nullable=False, server_default="{}")  # type: ignore[var-annotated]
    enabled = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )


class ReportRun(Base):
    __tablename__ = "mr_report_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, nullable=True)
    job_name = Column(Text, nullable=False)
    job_type = Column(Text, nullable=False)
    run_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )
    status = Column(Text, nullable=False)
    data = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    emailed_to = Column(ARRAY(Text), nullable=True)  # type: ignore[var-annotated]
