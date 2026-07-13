from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _nas_body(uid: str) -> dict:
    return {
        "nasname": f"10.99.{int(uid[:2], 16) % 255}.{int(uid[2:4], 16) % 255}",
        "shortname": f"nas_{uid}",
        "type": "other",
        "secret": "testing123",
        "description": f"Test NAS {uid}",
    }


@pytest.mark.asyncio
async def test_list_nas_unauthenticated(client):
    r = await client.get("/api/nas")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_nas(superadmin_client):
    uid = _uid()
    r = await superadmin_client.post("/api/nas", json=_nas_body(uid))
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    assert data["secret"] == "testing123"


@pytest.mark.asyncio
async def test_create_nas_duplicate_ip(superadmin_client):
    uid = _uid()
    body = _nas_body(uid)
    r1 = await superadmin_client.post("/api/nas", json=body)
    assert r1.status_code == 201

    r2 = await superadmin_client.post("/api/nas", json=body)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_get_nas(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/nas", json=_nas_body(uid))
    nas_id = create_r.json()["id"]

    r = await superadmin_client.get(f"/api/nas/{nas_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == nas_id


@pytest.mark.asyncio
async def test_update_nas(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/nas", json=_nas_body(uid))
    nas_id = create_r.json()["id"]

    r = await superadmin_client.put(f"/api/nas/{nas_id}", json={"description": "updated description"})
    assert r.status_code == 200
    assert r.json()["description"] == "updated description"


@pytest.mark.asyncio
async def test_delete_nas(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/nas", json=_nas_body(uid))
    nas_id = create_r.json()["id"]

    r = await superadmin_client.delete(f"/api/nas/{nas_id}")
    assert r.status_code == 204

    get_r = await superadmin_client.get(f"/api/nas/{nas_id}")
    assert get_r.status_code == 404


@pytest.mark.asyncio
async def test_ping_nas(superadmin_client):
    uid = _uid()
    create_r = await superadmin_client.post("/api/nas", json=_nas_body(uid))
    assert create_r.status_code == 201
    nas_id = create_r.json()["id"]

    r = await superadmin_client.post(f"/api/nas/{nas_id}/ping")
    assert r.status_code in (200, 404, 405), (
        f"Unexpected status {r.status_code}: {r.text}"
    )
    if r.status_code == 200:
        assert "ok" in r.json()
