from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.mark.asyncio
async def test_get_settings_superadmin(superadmin_client):
    r = await superadmin_client.get("/api/system/settings")
    assert r.status_code == 200
    data = r.json()
    assert "database_url" in data
    assert "debug" in data
    assert "enabled_modules" in data


@pytest.mark.asyncio
async def test_get_settings_admin(admin_client):
    r = await admin_client.get("/api/system/settings")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_get_settings_readonly(readonly_client):
    r = await readonly_client.get("/api/system/settings")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_backups(superadmin_client):
    r = await superadmin_client.get("/api/system/backup/list")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_admin_list(superadmin_client):
    r = await superadmin_client.get("/api/auth/admins")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1


@pytest.mark.asyncio
async def test_create_admin(superadmin_client):
    uid = _uid()
    r = await superadmin_client.post("/api/auth/admins", json={
        "username": f"newadmin_{uid}",
        "email": f"newadmin_{uid}@test.local",
        "password": "AdminPass1!",
        "role": "admin",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["username"] == f"newadmin_{uid}"
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_delete_admin(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/auth/admins", json={
        "username": f"disposable_{uid}",
        "email": f"disposable_{uid}@test.local",
        "password": "TempPass1!",
        "role": "admin",
    })
    assert create_r.status_code == 201
    admin_id = create_r.json()["id"]

    r = await superadmin_client.delete(f"/api/auth/admins/{admin_id}")
    assert r.status_code == 204
