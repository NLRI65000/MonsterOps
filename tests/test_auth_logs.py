from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_auth_logs_require_auth(client):
    r = await client.get("/api/auth-logs")
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["", "/anomalies", "/failed-counts", "/timeline"])
async def test_auth_logs_read_endpoints(superadmin_client, path):
    r = await superadmin_client.get(f"/api/auth-logs{path}")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


@pytest.mark.asyncio
async def test_auth_logs_list_limit_bounds(superadmin_client):
    assert (await superadmin_client.get("/api/auth-logs?limit=0")).status_code == 422
    assert (await superadmin_client.get("/api/auth-logs?limit=5000")).status_code == 422
    assert (await superadmin_client.get("/api/auth-logs?limit=10")).status_code == 200


@pytest.mark.asyncio
async def test_auth_logs_export_csv(superadmin_client):
    r = await superadmin_client.get("/api/auth-logs/export")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_auth_logs_keyset_matches_full_order(superadmin_client):
    import uuid
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.auth_logs.models import Radpostauth

    marker = f"ks-{uuid.uuid4().hex[:8]}"
    base = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    async with SessionLocal() as db:
        for i in range(7):
            db.add(Radpostauth(username=marker, reply="Access-Accept",
                               authdate=base - timedelta(minutes=i)))
        for _ in range(2):
            db.add(Radpostauth(username=marker, reply="Access-Accept",
                               authdate=base - timedelta(minutes=3)))
        await db.commit()

    try:
        full = (await superadmin_client.get(
            f"/api/auth-logs?username={marker}&limit=100")).json()
        expected_ids = [r["id"] for r in full]
        assert len(expected_ids) == 9

        collected, cursor, pages = [], None, 0
        while True:
            url = f"/api/auth-logs?username={marker}&limit=3"
            if cursor:
                url += f"&before={cursor}"
            resp = await superadmin_client.get(url)
            assert resp.status_code == 200
            batch = resp.json()
            collected += [r["id"] for r in batch]
            cursor = resp.headers.get("x-next-cursor")
            pages += 1
            if not cursor or len(batch) < 3:
                break
            assert pages < 10

        assert collected == expected_ids
        assert len(set(collected)) == len(collected)

        bad = await superadmin_client.get("/api/auth-logs?before=not-a-cursor")
        assert bad.status_code == 400
    finally:
        async with SessionLocal() as db:
            await db.execute(text("DELETE FROM radpostauth WHERE username = :u"), {"u": marker})
            await db.commit()
