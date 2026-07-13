"""Phase 22 — RADIUS Proxy & Realm Management tests."""
from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _server_body(**over) -> dict:
    body = {
        "name": f"hs_{_uid()}",
        "host": "10.99.0.10",
        "auth_port": 1812,
        "acct_port": 1813,
        "secret": "s3cret",
        "type": "auth",
    }
    body.update(over)
    return body



@pytest.mark.asyncio
async def test_server_crud(superadmin_client):
    body = _server_body(vpn_interface="wg0")
    r = await superadmin_client.post("/api/realms/servers", json=body)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["status"] == "unknown"

    r = await superadmin_client.get("/api/realms/servers")
    assert any(s["id"] == sid for s in r.json())

    upd = _server_body(name=body["name"], host="10.99.0.11", secret="")
    r = await superadmin_client.put(f"/api/realms/servers/{sid}", json=upd)
    assert r.status_code == 200, r.text
    assert r.json()["host"] == "10.99.0.11"

    r = await superadmin_client.delete(f"/api/realms/servers/{sid}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_server_duplicate_name(superadmin_client):
    body = _server_body()
    assert (await superadmin_client.post("/api/realms/servers", json=body)).status_code == 201
    assert (await superadmin_client.post("/api/realms/servers", json=body)).status_code == 409


@pytest.mark.parametrize("field,value", [
    ("name", "evil}\nhome_server x {"),
    ("name", "a b"),
    ("host", "1.2.3.4; rm -rf /"),
    ("host", "host}\ninject"),
    ("secret", 'pass"word'),
    ("secret", "line\nbreak"),
    ("vpn_interface", "wg0; reboot"),
])
@pytest.mark.asyncio
async def test_server_rejects_config_injection(superadmin_client, field, value):
    """proxy.conf-bound fields must reject values that could inject directives."""
    r = await superadmin_client.post("/api/realms/servers", json=_server_body(**{field: value}))
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_readonly_cannot_create_server(readonly_client):
    r = await readonly_client.post("/api/realms/servers", json=_server_body())
    assert r.status_code == 403



@pytest.mark.asyncio
async def test_pool_crud_with_members(superadmin_client):
    s1 = (await superadmin_client.post("/api/realms/servers", json=_server_body())).json()
    s2 = (await superadmin_client.post("/api/realms/servers", json=_server_body())).json()

    name = f"pool_{_uid()}"
    r = await superadmin_client.post("/api/realms/pools", json={
        "name": name, "pool_type": "load-balance", "server_ids": [s1["id"], s2["id"]],
    })
    assert r.status_code == 201, r.text
    pool = r.json()
    assert pool["server_ids"] == [s1["id"], s2["id"]]
    assert pool["status"] == "unknown"

    r = await superadmin_client.put(f"/api/realms/pools/{pool['id']}", json={
        "name": name, "pool_type": "fail-over", "server_ids": [s2["id"]],
    })
    assert r.status_code == 200
    assert r.json()["server_ids"] == [s2["id"]]

    r = await superadmin_client.delete(f"/api/realms/pools/{pool['id']}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_pool_unknown_server_rejected(superadmin_client):
    r = await superadmin_client.post("/api/realms/pools", json={
        "name": f"pool_{_uid()}", "pool_type": "fail-over", "server_ids": [999999],
    })
    assert r.status_code == 422



@pytest.mark.asyncio
async def test_realm_crud(superadmin_client):
    s = (await superadmin_client.post("/api/realms/servers", json=_server_body())).json()
    pool = (await superadmin_client.post("/api/realms/pools", json={
        "name": f"pool_{_uid()}", "pool_type": "fail-over", "server_ids": [s["id"]],
    })).json()

    name = f"corp-{_uid()}.net"
    r = await superadmin_client.post("/api/realms", json={
        "name": name, "pool_id": pool["id"], "strip_username": False,
    })
    assert r.status_code == 201, r.text
    realm = r.json()
    assert realm["pool_name"] == pool["name"]
    assert realm["strip_username"] is False

    r = await superadmin_client.get("/api/realms")
    assert any(x["name"] == name for x in r.json())

    r = await superadmin_client.put(f"/api/realms/{realm['id']}", json={
        "name": name, "pool_id": None, "strip_username": True,
    })
    assert r.status_code == 200
    assert r.json()["pool_id"] is None

    assert (await superadmin_client.delete(f"/api/realms/{realm['id']}")).status_code == 204


@pytest.mark.parametrize("bad", ["evil}\nrealm x {", "corp a.net", 'x"y', "-leading.dash"])
@pytest.mark.asyncio
async def test_realm_rejects_bad_names(superadmin_client, bad):
    r = await superadmin_client.post("/api/realms", json={"name": bad})
    assert r.status_code == 422, r.text



@pytest.mark.asyncio
async def test_nas_group_realm_routing(superadmin_client):
    grp = (await superadmin_client.post("/api/nas/groups/list", json={
        "name": f"ng_{_uid()}", "description": "test group",
    })).json()
    realm = (await superadmin_client.post("/api/realms", json={"name": f"r-{_uid()}.net"})).json()

    r = await superadmin_client.post("/api/realms/nas-routing", json={
        "nas_group_id": grp["id"], "realm_id": realm["id"],
    })
    assert r.status_code == 201, r.text
    link = r.json()
    assert link["nas_group_name"] == grp["name"]
    assert link["realm_name"] == realm["name"]

    r = await superadmin_client.post("/api/realms/nas-routing", json={
        "nas_group_id": grp["id"], "realm_id": realm["id"],
    })
    assert r.status_code == 409

    r = await superadmin_client.get("/api/realms/nas-routing")
    assert any(x["id"] == link["id"] for x in r.json())

    assert (await superadmin_client.delete(f"/api/realms/nas-routing/{link['id']}")).status_code == 204



@pytest.mark.asyncio
async def test_proxy_conf_preview(superadmin_client):
    s = (await superadmin_client.post("/api/realms/servers", json=_server_body(type="both"))).json()
    pool = (await superadmin_client.post("/api/realms/pools", json={
        "name": f"pp_{_uid()}", "pool_type": "fail-over", "server_ids": [s["id"]],
    })).json()
    realm = (await superadmin_client.post("/api/realms", json={
        "name": f"pv-{_uid()}.net", "pool_id": pool["id"], "strip_username": False,
    })).json()

    r = await superadmin_client.get("/api/realms/proxy-conf/preview")
    assert r.status_code == 200, r.text
    conf = r.json()["content"]

    assert f"home_server {s['name']}-auth {{" in conf
    assert f"home_server {s['name']}-acct {{" in conf
    assert 'secret = "s3cret"' in conf
    assert f"home_server_pool {pool['name']}-auth {{" in conf
    assert f"home_server_pool {pool['name']}-acct {{" in conf
    assert f"realm {realm['name']} {{" in conf
    assert f"auth_pool = {pool['name']}-auth" in conf
    assert f"acct_pool = {pool['name']}-acct" in conf
    assert "nostrip" in conf


@pytest.mark.asyncio
async def test_proxy_conf_preview_requires_admin(readonly_client):
    r = await readonly_client.get("/api/realms/proxy-conf/preview")
    assert r.status_code == 403
