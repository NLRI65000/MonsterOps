from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_notifications_require_auth(client):
    assert (await client.get("/api/notifications/channels")).status_code == 401


@pytest.mark.asyncio
async def test_notifications_history(superadmin_client):
    r = await superadmin_client.get("/api/notifications/history")
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


@pytest.mark.asyncio
async def test_channel_and_rule_lifecycle(superadmin_client):
    cname = f"chan_{uuid.uuid4().hex[:8]}"
    c = await superadmin_client.post("/api/notifications/channels", json={
        "name": cname, "type": "webhook", "config": {"url": "https://example.com/n"}})
    assert c.status_code in (200, 201), c.text
    cid = c.json()["id"]
    rid = None
    try:
        chans = (await superadmin_client.get("/api/notifications/channels")).json()
        assert any(x["id"] == cid for x in chans)

        rule = await superadmin_client.post("/api/notifications/rules", json={
            "name": f"rule_{uuid.uuid4().hex[:6]}", "event_type": "auth_failure",
            "channel_id": cid, "cooldown_minutes": 30})
        assert rule.status_code in (200, 201), rule.text
        rid = rule.json()["id"]
        rules = (await superadmin_client.get("/api/notifications/rules")).json()
        assert any(x["id"] == rid for x in rules)
    finally:
        if rid is not None:
            await superadmin_client.delete(f"/api/notifications/rules/{rid}")
        await superadmin_client.delete(f"/api/notifications/channels/{cid}")
