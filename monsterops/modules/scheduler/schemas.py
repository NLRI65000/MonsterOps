from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    job_type: str = Field(..., pattern="^(daily_summary|weekly_summary|expired_user_cleanup|stale_session_sweep|log_retention)$")
    cron_hour: int = Field(0, ge=0, le=23)
    cron_minute: int = Field(0, ge=0, le=59)
    cron_weekday: int | None = Field(None, ge=0, le=6)
    recipients: list[str] = Field(default_factory=list)
    enabled: bool = True


class JobUpdate(BaseModel):
    cron_hour: int | None = Field(None, ge=0, le=23)
    cron_minute: int | None = Field(None, ge=0, le=59)
    cron_weekday: int | None = None
    recipients: list[str] | None = None
    enabled: bool | None = None


class JobOut(BaseModel):
    id: int
    name: str
    job_type: str
    cron_hour: int
    cron_minute: int
    cron_weekday: int | None
    recipients: list[str]
    enabled: bool
    last_run_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportRunOut(BaseModel):
    id: int
    job_id: int | None
    job_name: str
    job_type: str
    run_at: datetime
    status: str
    data: dict[str, Any] | None
    error_message: str | None
    emailed_to: list[str] | None

    model_config = {"from_attributes": True}
