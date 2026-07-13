from __future__ import annotations

import hashlib
import hmac
import uuid

import pytest


def test_hmac_signature_scheme():
    secret, payload = "s3cret", b'{"event":"user.created"}'
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert len(sig) == 64
    assert hmac.compare_digest(sig, hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest())
    assert not hmac.compare_digest(sig, hmac.new(b"wrong", payload, hashlib.sha256).hexdigest())


@pytest.mark.asyncio
async def test_webhooks_require_auth(client):
    assert (await client.get("/api/webhooks")).status_code == 401


@pytest.mark.asyncio
async def test_webhook_secret_not_returned(superadmin_client):
    name = f"wh_{uuid.uuid4().hex[:8]}"
    r = await superadmin_client.post("/api/webhooks", json={
        "name": name, "url": "https://example.com/hook", "events": ["user.*"], "secret": "topsecret"})
    assert r.status_code in (200, 201), r.text
    body = r.json()
    sid = body["id"]
    try:
        assert "topsecret" not in str(body)
        assert body.get("has_secret") is True
    finally:
        await superadmin_client.delete(f"/api/webhooks/{sid}")


@pytest.mark.asyncio
async def test_webhook_bad_url_rejected(superadmin_client):
    r = await superadmin_client.post("/api/webhooks", json={
        "name": "bad", "url": "not-a-url", "events": ["*"]})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_webhook_roundtrip_and_list(superadmin_client):
    name = f"wh_{uuid.uuid4().hex[:8]}"
    r = await superadmin_client.post("/api/webhooks", json={
        "name": name, "url": "https://example.com/x", "events": ["nas.created", "nas.*"]})
    sid = r.json()["id"]
    try:
        listed = (await superadmin_client.get("/api/webhooks")).json()
        assert any(x["id"] == sid for x in listed)
    finally:
        await superadmin_client.delete(f"/api/webhooks/{sid}")
