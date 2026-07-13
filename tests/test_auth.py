from __future__ import annotations

import pytest



@pytest.mark.asyncio
async def test_auth_status(client):
    r = await client.get("/api/auth/status")
    assert r.status_code == 200
    data = r.json()
    assert "first_run" in data


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    r = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code in (401, 403, 422)


@pytest.mark.asyncio
async def test_login_missing_fields(client):
    r = await client.post("/api/auth/login", json={})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_protected_without_token(client):
    r = await client.get("/api/users")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_protected_with_invalid_token(client):
    r = await client.get("/api/users", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_refresh_without_cookie(client):
    r = await client.post("/api/auth/refresh")
    assert r.status_code in (401, 403)



@pytest.mark.asyncio
async def test_login_success(client):
    r = await client.post("/api/auth/login", json={"username": "testadmin", "password": "Test1234!"})
    assert r.status_code == 200
    assert "mr_access" in r.cookies
    assert "mr_csrf" in r.cookies
    data = r.json()
    assert "access_token" not in data
    assert data["role"] == "superadmin"
    assert data["username"] == "testadmin"
    client.cookies.clear()


@pytest.mark.asyncio
async def test_me_with_valid_token(superadmin_client):
    r = await superadmin_client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "testadmin"
    assert data["role"] == "superadmin"


@pytest.mark.asyncio
async def test_token_required_on_protected_route(client):
    for path in ["/api/users", "/api/nas", "/api/accounting"]:
        r = await client.get(path)
        assert r.status_code == 401, f"Expected 401 for {path}, got {r.status_code}"


@pytest.mark.asyncio
async def test_audit_log_after_login(superadmin_client):
    r = await superadmin_client.get("/api/auth/audit-log")
    assert r.status_code == 200
    entries = r.json()
    assert isinstance(entries, list)
    actions = [e["action"] for e in entries]
    assert "admin.login" in actions


@pytest.mark.asyncio
async def test_admin_list_superadmin(superadmin_client):
    r = await superadmin_client.get("/api/auth/admins")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    usernames = [u["username"] for u in data]
    assert "testadmin" in usernames


@pytest.mark.asyncio
async def test_admin_list_readonly_forbidden(readonly_client):
    r = await readonly_client.get("/api/auth/admins")
    assert r.status_code == 403



@pytest.mark.asyncio
async def test_cookie_auth_and_csrf(client):
    from monsterops.config import settings

    prev_debug = settings.debug
    settings.debug = True
    try:
        r = await client.post("/api/auth/login", json={"username": "testadmin", "password": "Test1234!"})
        assert r.status_code == 200
        csrf = client.cookies.get("mr_csrf")
        assert csrf

        me = await client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["username"] == "testadmin"

        no_csrf = await client.post("/api/auth/refresh")
        assert no_csrf.status_code == 403

        ok = await client.post("/api/auth/refresh", headers={"X-CSRF-Token": client.cookies.get("mr_csrf")})
        assert ok.status_code == 204
    finally:
        client.cookies.clear()
        settings.debug = prev_debug


@pytest.mark.asyncio
async def test_login_returns_no_body_token(client):
    r = await client.post("/api/auth/login", json={"username": "testadmin", "password": "Test1234!"})
    assert r.status_code == 200
    assert "access_token" not in r.text
    client.cookies.clear()
