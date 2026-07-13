from __future__ import annotations

import uuid

import pytest


def _gname() -> str:
    return f"grp_{uuid.uuid4().hex[:8]}"


@pytest.mark.asyncio
async def test_groups_require_auth(client):
    assert (await client.get("/api/groups")).status_code == 401


@pytest.mark.asyncio
async def test_login_types_endpoint(superadmin_client):
    r = await superadmin_client.get("/api/groups/login-types")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_readonly_cannot_create_group(readonly_client):
    r = await readonly_client.post("/api/groups", json={"name": _gname()})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_group_full_lifecycle(superadmin_client):
    name = _gname()
    r = await superadmin_client.post("/api/groups", json={"name": name})
    assert r.status_code in (200, 201), r.text
    try:
        c = await superadmin_client.post(f"/api/groups/{name}/check", json={
            "attribute": "Auth-Type", "op": ":=", "value": "Accept"})
        assert c.status_code in (200, 201), c.text
        rp = await superadmin_client.post(f"/api/groups/{name}/reply", json={
            "attribute": "Framed-MTU", "op": ":=", "value": "1400"})
        assert rp.status_code in (200, 201)
        listed = (await superadmin_client.get("/api/groups")).json()
        names = [g.get("groupname") or g.get("name") for g in
                 (listed if isinstance(listed, list) else listed.get("items", []))]
        assert name in names
        new = _gname()
        rn = await superadmin_client.put(f"/api/groups/{name}/rename", json={"name": new})
        assert rn.status_code == 200
        name = new
    finally:
        await superadmin_client.delete(f"/api/groups/{name}")


@pytest.mark.asyncio
async def test_duplicate_group_conflicts(superadmin_client):
    name = _gname()
    r1 = await superadmin_client.post("/api/groups", json={"name": name})
    assert r1.status_code in (200, 201)
    try:
        r2 = await superadmin_client.post("/api/groups", json={"name": name})
        assert r2.status_code == 409
    finally:
        await superadmin_client.delete(f"/api/groups/{name}")
