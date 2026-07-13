from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _job_body(uid: str) -> dict:
    return {
        "name": f"job_{uid}",
        "job_type": "daily_summary",
        "cron_hour": 8,
        "cron_minute": 0,
        "recipients": ["test@example.com"],
        "enabled": False,
    }


@pytest.mark.asyncio
async def test_create_job(superadmin_client):
    uid = _uid()
    r = await superadmin_client.post("/api/scheduler/jobs", json=_job_body(uid))
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == f"job_{uid}"
    assert data["job_type"] == "daily_summary"
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_list_jobs(superadmin_client):
    await superadmin_client.post("/api/scheduler/jobs", json=_job_body(_uid()))

    r = await superadmin_client.get("/api/scheduler/jobs")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_update_job(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/scheduler/jobs", json=_job_body(uid))
    job_id = create_r.json()["id"]

    r = await superadmin_client.put(f"/api/scheduler/jobs/{job_id}", json={
        "cron_hour": 10,
        "recipients": ["updated@example.com"],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["cron_hour"] == 10
    assert "updated@example.com" in data["recipients"]


@pytest.mark.asyncio
async def test_delete_job(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/scheduler/jobs", json=_job_body(uid))
    job_id = create_r.json()["id"]

    r = await superadmin_client.delete(f"/api/scheduler/jobs/{job_id}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_run_job_now(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/scheduler/jobs", json=_job_body(uid))
    job_id = create_r.json()["id"]

    r = await superadmin_client.post(f"/api/scheduler/jobs/{job_id}/run")
    assert r.status_code == 202
    data = r.json()
    assert "job_id" in data


@pytest.mark.asyncio
async def test_list_reports(superadmin_client):
    r = await superadmin_client.get("/api/scheduler/reports")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_job_fn_registry_maps_every_type():
    from monsterops.modules.scheduler import jobs
    from monsterops.modules.scheduler.service import job_fn_for

    assert job_fn_for("daily_summary") is jobs.run_daily_summary
    assert job_fn_for("weekly_summary") is jobs.run_weekly_summary
    assert job_fn_for("expired_user_cleanup") is jobs.run_expired_user_cleanup
    assert job_fn_for("stale_session_sweep") is jobs.run_stale_session_sweep
    assert job_fn_for("log_retention") is jobs.run_log_retention


@pytest.mark.asyncio
async def test_create_log_retention_job(superadmin_client):
    body = _job_body(_uid()) | {"job_type": "log_retention"}
    r = await superadmin_client.post("/api/scheduler/jobs", json=body)
    assert r.status_code == 201, r.text
    jid = r.json()["id"]
    await superadmin_client.delete(f"/api/scheduler/jobs/{jid}")


@pytest.mark.asyncio
async def test_log_retention_prunes_only_old_rows():
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import delete, select

    from monsterops.config import settings
    from monsterops.database import SessionLocal
    from monsterops.modules.auth.models import AuditLog
    from monsterops.modules.scheduler.jobs import run_log_retention

    marker = "_tmp_retention_test"
    now = datetime.now(tz=timezone.utc)
    old = now - timedelta(days=settings.retention_audit_log_days + 10)

    async with SessionLocal() as db:
        db.add(AuditLog(admin_username=marker, action="test.old", created_at=old))
        db.add(AuditLog(admin_username=marker, action="test.recent", created_at=now))
        await db.commit()

    try:
        await run_log_retention(None, "retention-test", [])

        async with SessionLocal() as db:
            rows = (await db.execute(
                select(AuditLog.action).where(AuditLog.admin_username == marker)
            )).scalars().all()
        assert "test.old" not in rows
        assert "test.recent" in rows
    finally:
        async with SessionLocal() as db:
            await db.execute(delete(AuditLog).where(AuditLog.admin_username == marker))
            await db.commit()
