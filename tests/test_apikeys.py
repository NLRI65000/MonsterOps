from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.mark.asyncio
async def test_create_api_key(superadmin_client):
    r = await superadmin_client.post("/api/apikeys", json={
        "name": f"key_{_uid()}",
        "scopes": ["sessions.read"],
    })
    assert r.status_code == 201
    data = r.json()
    assert "plaintext_key" in data
    assert data["plaintext_key"].startswith("mr_")
    assert "sessions.read" in data["scopes"]


@pytest.mark.asyncio
async def test_list_api_keys(superadmin_client):
    await superadmin_client.post("/api/apikeys", json={
        "name": f"listkey_{_uid()}", "scopes": ["sessions.read"],
    })
    r = await superadmin_client.get("/api/apikeys")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1


@pytest.mark.asyncio
async def test_revoke_api_key(superadmin_client):
    create_r = await superadmin_client.post("/api/apikeys", json={
        "name": f"revoke_{_uid()}", "scopes": ["sessions.read"],
    })
    key_id = create_r.json()["id"]

    r = await superadmin_client.delete(f"/api/apikeys/{key_id}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_ext_sessions_no_key(client):
    r = await client.get("/api/ext/sessions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ext_sessions_wrong_key(client):
    r = await client.get("/api/ext/sessions", headers={"X-API-Key": "mr_invalid_key_here"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ext_sessions_valid_key(superadmin_client, client):
    create_r = await superadmin_client.post("/api/apikeys", json={
        "name": f"sess_{_uid()}", "scopes": ["sessions.read"],
    })
    assert create_r.status_code == 201
    plaintext = create_r.json()["plaintext_key"]

    r = await client.get("/api/ext/sessions", headers={"X-API-Key": plaintext})
    assert r.status_code == 200
    data = r.json()
    assert "sessions" in data
    assert "count" in data


@pytest.mark.asyncio
async def test_ext_user_wrong_scope(superadmin_client, client):
    create_r = await superadmin_client.post("/api/apikeys", json={
        "name": f"nousers_{_uid()}", "scopes": ["sessions.read"],
    })
    plaintext = create_r.json()["plaintext_key"]

    r = await client.get("/api/ext/users/someuser", headers={"X-API-Key": plaintext})
    assert r.status_code == 403
