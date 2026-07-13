from __future__ import annotations

import pytest



@pytest.mark.asyncio
async def test_health_endpoint(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data


@pytest.mark.asyncio
async def test_manifests_endpoint(client):
    r = await client.get("/api/manifests")
    assert r.status_code == 200
    assert isinstance(r.json(), list)



@pytest.mark.asyncio
async def test_health_status_authenticated(superadmin_client):
    r = await superadmin_client.get("/api/health/status")
    assert r.status_code == 200
    data = r.json()
    assert "freeradius" in data
    assert "database" in data
    assert "ok" in data["database"]


@pytest.mark.asyncio
async def test_validate_config_superadmin(superadmin_client):
    r = await superadmin_client.post("/api/health/validate-config")
    assert r.status_code in (200, 500)
    if r.status_code == 200:
        data = r.json()
        assert "ok" in data
        assert "return_code" in data


@pytest.mark.asyncio
async def test_validate_config_readonly(readonly_client):
    r = await readonly_client.post("/api/health/validate-config")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_log_files_list(superadmin_client):
    r = await superadmin_client.get("/api/health/logs/files")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
