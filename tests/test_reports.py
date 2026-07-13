from __future__ import annotations

import pytest

_REPORTS = ["login-frequency", "bandwidth", "top-users", "failed-trend", "nas-traffic", "online-time"]


@pytest.mark.asyncio
async def test_reports_require_auth(client):
    r = await client.get("/api/reports/login-frequency")
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("report", _REPORTS)
async def test_report_endpoints_ok(superadmin_client, report):
    r = await superadmin_client.get(f"/api/reports/{report}")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_report_export_requires_valid_report(superadmin_client):
    r = await superadmin_client.get("/api/reports/export")
    assert r.status_code == 422
    r = await superadmin_client.get("/api/reports/export?report=top-users")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_top_users_metric_validation(superadmin_client):
    r = await superadmin_client.get("/api/reports/top-users?metric=bogus")
    assert r.status_code == 422
    for metric in ("bandwidth", "sessions", "time"):
        r = await superadmin_client.get(f"/api/reports/top-users?metric={metric}")
        assert r.status_code == 200
