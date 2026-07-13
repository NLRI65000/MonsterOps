from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_list_sessions_unauthenticated(client):
    r = await client.get("/api/accounting")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_sessions(superadmin_client):
    r = await superadmin_client.get("/api/accounting")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_sessions_active_filter(superadmin_client):
    r = await superadmin_client.get("/api/accounting", params={"active_only": "true"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for sess in data:
        assert sess.get("active") is True or sess.get("acctstoptime") is None


@pytest.mark.asyncio
async def test_stream_unauthenticated(client):
    r = await client.get("/api/accounting/stream")
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.slow
async def test_stream_opens(superadmin_client):
    captured: dict = {}

    async def _fetch() -> None:
        r = await superadmin_client.get("/api/accounting/stream")
        captured["status"] = r.status_code
        captured["ct"] = r.headers.get("content-type", "")

    task = asyncio.create_task(_fetch())
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
        assert captured.get("status") == 200
        assert "text/event-stream" in captured.get("ct", "")
    except asyncio.TimeoutError:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    except Exception as exc:
        task.cancel()
        raise AssertionError(f"Unexpected error from stream endpoint: {exc}") from exc
