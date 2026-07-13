from __future__ import annotations

import uuid

import pytest


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.mark.asyncio
async def test_list_users_unauthenticated(client):
    r = await client.get("/api/users")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_users_superadmin(superadmin_client):
    r = await superadmin_client.get("/api/users")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "items" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_create_user(superadmin_client):
    username = f"testuser_{_uid()}"
    r = await superadmin_client.post("/api/users", json={
        "username": username,
        "password": "Passw0rd!",
        "password_type": "Cleartext-Password",
        "groups": [],
    })
    assert r.status_code == 201
    data = r.json()
    assert data["username"] == username

    list_r = await superadmin_client.get("/api/users", params={"search": username})
    assert list_r.status_code == 200
    assert any(u["username"] == username for u in list_r.json()["items"])


@pytest.mark.parametrize("bad_username", [
    'a"><img src=x onerror=alert(1)>',
    "x<script>alert(1)</script>",
    "user&amp;name",
    "quote'name",
    "back`tick",
    "ctrl\x00null",
])
@pytest.mark.asyncio
async def test_create_user_rejects_xss_username(superadmin_client, bad_username):
    r = await superadmin_client.post("/api/users", json={
        "username": bad_username,
        "password": "Passw0rd!",
        "password_type": "Cleartext-Password",
        "groups": [],
    })
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("ok_username", [
    "user@realm.net",
    "00:11:22:33:44:55",
    "a.b-c_d+e=f/g",
])
@pytest.mark.asyncio
async def test_create_user_allows_valid_radius_username(superadmin_client, ok_username):
    r = await superadmin_client.post("/api/users", json={
        "username": ok_username,
        "password": "Passw0rd!",
        "password_type": "Cleartext-Password",
        "groups": [],
    })
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_create_user_duplicate(superadmin_client):
    username = f"dup_{_uid()}"
    body = {"username": username, "password": "Passw0rd!", "password_type": "Cleartext-Password", "groups": []}
    r1 = await superadmin_client.post("/api/users", json=body)
    assert r1.status_code == 201

    r2 = await superadmin_client.post("/api/users", json=body)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_get_user(superadmin_client):
    username = f"getme_{_uid()}"
    await superadmin_client.post("/api/users", json={
        "username": username, "password": "Passw0rd!",
        "password_type": "Cleartext-Password", "groups": [],
    })
    r = await superadmin_client.get(f"/api/users/{username}")
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == username
    assert "check_attrs" in data


@pytest.mark.asyncio
async def test_get_user_not_found(superadmin_client):
    r = await superadmin_client.get(f"/api/users/nonexistent_user_{_uid()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_user(superadmin_client):
    username = f"upd_{_uid()}"
    await superadmin_client.post("/api/users", json={
        "username": username, "password": "OldPass1!",
        "password_type": "Cleartext-Password", "groups": [],
    })

    r = await superadmin_client.put(f"/api/users/{username}", json={
        "password": "NewPass2!", "password_type": "Cleartext-Password",
    })
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_delete_user(superadmin_client):
    username = f"del_{_uid()}"
    await superadmin_client.post("/api/users", json={
        "username": username, "password": "Passw0rd!",
        "password_type": "Cleartext-Password", "groups": [],
    })

    r = await superadmin_client.delete(f"/api/users/{username}")
    assert r.status_code == 204

    get_r = await superadmin_client.get(f"/api/users/{username}")
    assert get_r.status_code == 404


@pytest.mark.asyncio
async def test_readonly_cannot_create(readonly_client):
    r = await readonly_client.post("/api/users", json={
        "username": f"ro_{_uid()}", "password": "Passw0rd!",
        "password_type": "Cleartext-Password", "groups": [],
    })
    assert r.status_code == 403
