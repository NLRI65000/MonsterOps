from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import require_roles

from .models import ReportRun, SchedulerJob
from .schemas import JobCreate, JobOut, JobUpdate, ReportRunOut
from .service import schedule_job, unschedule_job

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    rows = (
        (await db.execute(select(SchedulerJob).order_by(SchedulerJob.created_at))).scalars().all()
    )
    return rows


@router.post("/jobs", response_model=JobOut, status_code=201)
async def create_job(
    body: JobCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    if await db.scalar(select(SchedulerJob).where(SchedulerJob.name == body.name)):
        raise HTTPException(409, "A job with that name already exists")

    row = SchedulerJob(
        name=body.name,
        job_type=body.job_type,
        cron_hour=body.cron_hour,
        cron_minute=body.cron_minute,
        cron_weekday=body.cron_weekday,
        recipients=body.recipients,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    if row.enabled:
        schedule_job(
            job_id=row.id,
            job_type=str(row.job_type),
            cron_hour=int(row.cron_hour),
            cron_minute=int(row.cron_minute),
            cron_weekday=row.cron_weekday,
            job_name=str(row.name),
            recipients=list(row.recipients or []),
        )
    return row


@router.put("/jobs/{job_id}", response_model=JobOut)
async def update_job(
    job_id: int,
    body: JobUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    row = await db.get(SchedulerJob, job_id)
    if not row:
        raise HTTPException(404, "Job not found")

    if body.cron_hour is not None:
        row.cron_hour = body.cron_hour  # type: ignore[assignment]
    if body.cron_minute is not None:
        row.cron_minute = body.cron_minute  # type: ignore[assignment]
    if body.cron_weekday is not None:
        row.cron_weekday = body.cron_weekday  # type: ignore[assignment]
    if body.recipients is not None:
        row.recipients = body.recipients  # type: ignore[assignment]
    if body.enabled is not None:
        row.enabled = body.enabled  # type: ignore[assignment]

    await db.commit()
    await db.refresh(row)

    if row.enabled:
        schedule_job(
            job_id=row.id,
            job_type=str(row.job_type),
            cron_hour=int(row.cron_hour),
            cron_minute=int(row.cron_minute),
            cron_weekday=row.cron_weekday,
            job_name=str(row.name),
            recipients=list(row.recipients or []),
        )
    else:
        unschedule_job(row.id)
    return row


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    row = await db.get(SchedulerJob, job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    unschedule_job(row.id)
    await db.delete(row)
    await db.commit()


@router.post("/jobs/{job_id}/run", status_code=202)
async def run_job_now(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> Any:
    row = await db.get(SchedulerJob, job_id)
    if not row:
        raise HTTPException(404, "Job not found")

    from .service import job_fn_for

    fn = job_fn_for(str(row.job_type))
    asyncio.ensure_future(fn(row.id, str(row.name), list(row.recipients or [])))
    return {"message": f"Job '{row.name}' triggered", "job_id": job_id}


@router.get("/reports", response_model=list[ReportRunOut])
async def list_reports(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    rows = (
        (await db.execute(select(ReportRun).order_by(ReportRun.run_at.desc()).limit(limit)))
        .scalars()
        .all()
    )
    return rows


@router.get("/reports/{report_id}", response_model=ReportRunOut)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    row = await db.get(ReportRun, report_id)
    if not row:
        raise HTTPException(404, "Report not found")
    return row
