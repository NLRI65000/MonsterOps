from __future__ import annotations

import uuid

import pytest

from monsterops.modules.vpn.backends.base import ConfigError
from monsterops.modules.vpn.models import VpnTunnel
from monsterops.modules.vpn.service import get_backend
from monsterops.modules.vpn.wgkeys import generate_keypair, public_from_private

_PEER_PRIV, _PEER_PUB = generate_keypair()


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _wg_body(**over) -> dict:
    b = {
        "name": f"wg{_uid()}",
        "type": "wireguard",
        "wg_address": "10.99.0.2/32",
        "wg_peer_public_key": _PEER_PUB,
        "wg_peer_host": "vpn.example.net",
        "wg_peer_port": 51820,
        "routes": ["10.20.0.0/24"],
    }
    b.update(over)
    return b


def _l2_body(**over) -> dict:
    b = {
        "name": f"l2{_uid()}",
        "type": "l2tp-ipsec",
        "l2tp_gateway": "vpn.example.net",
        "l2tp_psk": "s3cretpsk",
        "l2tp_username": "user1",
        "l2tp_password": "p4ssw0rd",
        "routes": ["10.30.0.0/24"],
    }
    b.update(over)
    return b



def test_wg_keygen_is_deterministic_and_32_bytes():
    priv, pub = generate_keypair()
    import base64
    assert len(base64.b64decode(priv)) == 32
    assert len(base64.b64decode(pub)) == 32
    assert public_from_private(priv) == pub


def test_wg_keygen_rfc7748_vector():
    from monsterops.modules.vpn.wgkeys import _x25519
    k = bytes.fromhex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4")
    u = bytes.fromhex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c")
    assert _x25519(k, u).hex() == "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552"



@pytest.mark.asyncio
async def test_wireguard_crud(superadmin_client):
    r = await superadmin_client.post("/api/vpn", json=_wg_body())
    assert r.status_code == 201, r.text
    t = r.json()
    tid = t["id"]
    assert t["wg_public_key"]
    assert "wg_private_key" not in t
    assert t["oper_state"] == "unknown"
    assert t["routes"] == ["10.20.0.0/24"]

    assert (await superadmin_client.get(f"/api/vpn/{tid}")).json()["name"] == t["name"]
    assert any(x["id"] == tid for x in (await superadmin_client.get("/api/vpn")).json())

    r = await superadmin_client.put(f"/api/vpn/{tid}", json=_wg_body(
        name=t["name"], wg_address="10.99.0.3/32", routes=["10.20.0.0/24", "10.21.0.0/24"]))
    assert r.status_code == 200, r.text
    assert r.json()["wg_address"] == "10.99.0.3/32"
    assert r.json()["routes"] == ["10.20.0.0/24", "10.21.0.0/24"]

    assert (await superadmin_client.delete(f"/api/vpn/{tid}")).status_code == 204


@pytest.mark.asyncio
async def test_duplicate_name_rejected(superadmin_client):
    body = _wg_body()
    assert (await superadmin_client.post("/api/vpn", json=body)).status_code == 201
    assert (await superadmin_client.post("/api/vpn", json=body)).status_code == 409


@pytest.mark.asyncio
async def test_import_private_key_derives_public(superadmin_client):
    priv, pub = generate_keypair()
    r = await superadmin_client.post("/api/vpn", json=_wg_body(wg_private_key=priv))
    assert r.status_code == 201, r.text
    assert r.json()["wg_public_key"] == pub


@pytest.mark.asyncio
async def test_regenerate_keys_changes_public(superadmin_client):
    t = (await superadmin_client.post("/api/vpn", json=_wg_body())).json()
    old = t["wg_public_key"]
    r = await superadmin_client.post(f"/api/vpn/{t['id']}/regenerate-keys", json={})
    assert r.status_code == 200
    assert r.json()["wg_public_key"] != old



@pytest.mark.asyncio
async def test_l2tp_crud_hides_secrets(superadmin_client):
    r = await superadmin_client.post("/api/vpn", json=_l2_body())
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["l2tp_has_secrets"] is True
    assert "l2tp_psk" not in t and "l2tp_password" not in t
    assert t["l2tp_username"] == "user1"

    r = await superadmin_client.put(f"/api/vpn/{t['id']}", json=_l2_body(
        name=t["name"], l2tp_psk=None, l2tp_password=None))
    assert r.status_code == 200, r.text
    assert r.json()["l2tp_has_secrets"] is True


@pytest.mark.asyncio
async def test_l2tp_requires_secrets_on_create(superadmin_client):
    r = await superadmin_client.post("/api/vpn", json=_l2_body(l2tp_psk=None, l2tp_password=None))
    assert r.status_code == 422



@pytest.mark.parametrize("field,value", [
    ("name", "a/b"),
    ("name", "a b"),
    ("name", "waytoolonginterface"),
    ("wg_address", "not-an-ip"),
    ("wg_address", "10.0.0.0/24; reboot"),
    ("wg_peer_public_key", "too-short"),
    ("wg_peer_public_key", "!" * 44),
    ("wg_peer_host", "host; reboot"),
    ("wg_peer_host", "host\ninject"),
])
@pytest.mark.asyncio
async def test_wireguard_rejects_injection(superadmin_client, field, value):
    r = await superadmin_client.post("/api/vpn", json=_wg_body(**{field: value}))
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("routes", [["999.0.0.0/8"], ["10.0.0.0/24; x"], ["garbage"]])
@pytest.mark.asyncio
async def test_routes_must_be_valid_cidrs(superadmin_client, routes):
    r = await superadmin_client.post("/api/vpn", json=_wg_body(routes=routes))
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("field,value", [
    ("l2tp_gateway", "gw; reboot"),
    ("l2tp_psk", 'pa"ss'),
    ("l2tp_psk", "line\nbreak"),
    ("l2tp_password", 'pa"ss'),
    ("l2tp_password", "back\\slash"),
    ("l2tp_username", "user name"),
    ("l2tp_username", "user;evil"),
])
@pytest.mark.asyncio
async def test_l2tp_rejects_injection(superadmin_client, field, value):
    r = await superadmin_client.post("/api/vpn", json=_l2_body(**{field: value}))
    assert r.status_code == 422, r.text


def test_backend_revalidates_before_render():
    t = VpnTunnel(name="evil}\ninject", type="wireguard", routes="10.0.0.0/24",
                  wg_private_key=_PEER_PRIV, wg_public_key=_PEER_PUB,
                  wg_address="10.99.0.2/32", wg_peer_public_key=_PEER_PUB,
                  wg_peer_host="vpn.example.net", wg_peer_port=51820)
    with pytest.raises((ConfigError, ValueError)):
        get_backend("wireguard").preview(t)



def test_wireguard_config_render():
    priv, pub = generate_keypair()
    t = VpnTunnel(name="wgtest", type="wireguard", routes="10.20.0.0/24,10.21.0.0/24",
                  wg_private_key=priv, wg_public_key=pub, wg_address="10.99.0.2/32",
                  wg_peer_public_key=_PEER_PUB, wg_peer_host="vpn.example.net",
                  wg_peer_port=51820, wg_persistent_keepalive=25, wg_dns="")
    be = get_backend("wireguard")
    full = be._render(t, redact=False)
    assert "[Interface]" in full and "[Peer]" in full
    assert "Address = 10.99.0.2/32" in full
    assert f"PrivateKey = {priv}" in full
    assert f"PublicKey = {_PEER_PUB}" in full
    assert "Endpoint = vpn.example.net:51820" in full
    assert "AllowedIPs = 10.20.0.0/24, 10.21.0.0/24" in full
    assert "PersistentKeepalive = 25" in full
    preview, files = be.preview(t)
    assert priv not in preview
    assert "PrivateKey = <hidden" in preview
    assert files == ["/etc/monsterops/vpn/wgtest.conf"]


def test_l2tp_config_render():
    t = VpnTunnel(name="l2test", type="l2tp-ipsec", routes="10.30.0.0/24",
                  l2tp_gateway="vpn.example.net", l2tp_psk="mypsk",
                  l2tp_username="user1", l2tp_password="p4ss")
    preview, files = get_backend("l2tp-ipsec").preview(t)
    assert any("ipsec.d/mr-l2test.conf" in f for f in files)
    assert any("chap-secrets" in f for f in files)
    assert "conn mr-l2test" in preview
    assert "right=vpn.example.net" in preview
    assert "[lac mr-l2test]" in preview
    assert "name user1" in preview
    assert '"user1" *' in preview
    assert "mypsk" not in preview
    assert "p4ss" not in preview



@pytest.mark.asyncio
async def test_bring_up_requires_superadmin(readonly_client, admin_client):
    t = (await admin_client.post("/api/vpn", json=_wg_body())).json()
    assert (await readonly_client.post(f"/api/vpn/{t['id']}/up", json={})).status_code == 403


@pytest.mark.asyncio
async def test_bring_up_reports_missing_tooling(superadmin_client):
    t = (await superadmin_client.post("/api/vpn", json=_wg_body())).json()
    r = await superadmin_client.post(f"/api/vpn/{t['id']}/up", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert "wireguard-tools" in (body["detail"] or "")


@pytest.mark.asyncio
async def test_readonly_cannot_create(readonly_client):
    assert (await readonly_client.post("/api/vpn", json=_wg_body())).status_code == 403


@pytest.mark.asyncio
async def test_config_preview_forbidden_for_readonly(readonly_client, superadmin_client):
    t = (await superadmin_client.post("/api/vpn", json=_wg_body())).json()
    assert (await readonly_client.get(f"/api/vpn/{t['id']}/config-preview")).status_code == 403
