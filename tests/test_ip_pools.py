from __future__ import annotations

import uuid

import pytest


def _pname() -> str:
    return f"pool_{uuid.uuid4().hex[:8]}"


@pytest.mark.asyncio
async def test_ip_pools_require_auth(client):
    assert (await client.get("/api/ip-pools")).status_code == 401


@pytest.mark.asyncio
async def test_readonly_cannot_create_pool(readonly_client):
    r = await readonly_client.post("/api/ip-pools", json={"pool_name": _pname(), "cidr": "10.10.0.0/29"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_pool_lifecycle(superadmin_client):
    name = _pname()
    r = await superadmin_client.post("/api/ip-pools", json={"pool_name": name, "cidr": "10.77.7.0/29"})
    assert r.status_code in (200, 201), r.text
    try:
        pools = (await superadmin_client.get("/api/ip-pools")).json()
        items = pools if isinstance(pools, list) else pools.get("items", [])
        assert any((p.get("pool_name") or p.get("name")) == name for p in items)

        entries = await superadmin_client.get(f"/api/ip-pools/{name}/entries")
        assert entries.status_code == 200
        rows = entries.json()
        rows = rows if isinstance(rows, list) else rows.get("items", [])
        assert len(rows) >= 1
    finally:
        await superadmin_client.delete(f"/api/ip-pools/{name}")


@pytest.mark.asyncio
async def test_pool_invalid_cidr_rejected(superadmin_client):
    r = await superadmin_client.post("/api/ip-pools", json={"pool_name": _pname(), "cidr": "not-a-cidr"})
    assert r.status_code in (400, 422)
