from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_integrations_require_auth(client):
    assert (await client.get("/api/integrations/status")).status_code == 401


@pytest.mark.asyncio
async def test_integrations_status(superadmin_client):
    r = await superadmin_client.get("/api/integrations/status")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


@pytest.mark.asyncio
async def test_integration_lifecycle(superadmin_client):
    name = f"int_{uuid.uuid4().hex[:8]}"
    r = await superadmin_client.post("/api/integrations", json={
        "name": name, "type": "graylog", "config": {"host": "graylog.local", "port": 12201},
        "enabled": False})
    assert r.status_code in (200, 201), r.text
    iid = r.json()["id"]
    try:
        listed = (await superadmin_client.get("/api/integrations")).json()
        items = listed if isinstance(listed, list) else listed.get("items", [])
        assert any(x["id"] == iid for x in items)
        u = await superadmin_client.put(f"/api/integrations/{iid}", json={"enabled": True})
        assert u.status_code == 200
    finally:
        await superadmin_client.delete(f"/api/integrations/{iid}")
