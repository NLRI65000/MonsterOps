from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_dashboard_requires_auth(client):
    r = await client.get("/api/dashboard/stats")
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/stats", "/online-users", "/nas-status", "/session-types"])
async def test_dashboard_endpoints_ok(superadmin_client, path):
    r = await superadmin_client.get(f"/api/dashboard{path}")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, (dict, list))


@pytest.mark.asyncio
async def test_dashboard_stats_range(superadmin_client):
    for rng in ("today", "7d", "30d"):
        r = await superadmin_client.get(f"/api/dashboard/stats?range={rng}")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)
