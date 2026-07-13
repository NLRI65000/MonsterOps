from __future__ import annotations

import pytest

from monsterops.modules.nas_manager import crypto
from monsterops.modules.nas_manager.history import diff_stats, normalize_config, unified_diff
from monsterops.modules.nas_manager.schemas import NasManagerCreate
from monsterops.modules.nas_manager.vendor_map import (
    apply_conn_type,
    device_types_for,
    resolve_vendor,
)



def test_crypto_roundtrip():
    secret = "unit-test-secret-key"
    ct = crypto.encrypt("hunter2", secret)
    assert ct != "hunter2"
    assert crypto.decrypt(ct, secret) == "hunter2"


def test_crypto_nonce_is_random():
    secret = "k"
    assert crypto.encrypt("same", secret) != crypto.encrypt("same", secret)


def test_crypto_wrong_secret_fails():
    ct = crypto.encrypt("secret-data", "right-key")
    with pytest.raises(Exception):
        crypto.decrypt(ct, "wrong-key")


def test_crypto_reencrypt():
    ct = crypto.encrypt("pw", "old")
    ct2 = crypto.reencrypt(ct, "old", "new")
    assert crypto.decrypt(ct2, "new") == "pw"
    with pytest.raises(Exception):
        crypto.decrypt(ct2, "old")



def test_resolve_vendor_exact():
    assert resolve_vendor("mikrotik") == "mikrotik"
    assert resolve_vendor("cisco") == "cisco"


def test_resolve_vendor_fuzzy():
    assert resolve_vendor("Mikrotik RouterOS") == "mikrotik"
    assert resolve_vendor("Cisco IOS XE") == "cisco"
    assert resolve_vendor("HUAWEI VRP") == "huawei"


def test_resolve_vendor_unsupported():
    assert resolve_vendor("other") is None
    assert resolve_vendor("pfSense") is None
    assert resolve_vendor("") is None
    assert resolve_vendor(None) is None


def test_device_types_for():
    assert device_types_for("mikrotik") == ["mikrotik_routeros"]
    assert device_types_for("Mikrotik RouterOS") == ["mikrotik_routeros"]
    assert device_types_for("other") == []


def test_apply_conn_type():
    assert apply_conn_type("mikrotik_routeros", "ssh") == "mikrotik_routeros"
    assert apply_conn_type("mikrotik_routeros", "telnet") == "mikrotik_routeros_telnet"
    assert apply_conn_type("mikrotik_routeros_telnet", "ssh") == "mikrotik_routeros"



def test_normalize_masks_mikrotik_timestamp():
    a = "# jul/02/2026 15:54:38 by RouterOS 6.48.6\n/system identity\nset name=RB"
    b = "# jul/02/2026 15:55:04 by RouterOS 6.48.6\n/system identity\nset name=RB"
    assert normalize_config(a) == normalize_config(b)


def test_diff_stats_ignores_timestamp_only():
    a = "# jul/02/2026 15:54:38 by RouterOS 6.48.6\nset name=RB"
    b = "# jul/02/2026 15:55:04 by RouterOS 6.48.6\nset name=RB"
    assert diff_stats(a, b) == (0, 0)


def test_diff_stats_counts_real_change():
    a = "set name=RB-OLD"
    b = "set name=RB-NEW"
    added, removed = diff_stats(a, b)
    assert added == 1 and removed == 1


def test_unified_diff_shows_real_change_only():
    a = "# jul/02/2026 15:54:38 by RouterOS 6.48.6\nset name=RB-OLD"
    b = "# jul/02/2026 15:55:04 by RouterOS 6.48.6\nset name=RB-NEW"
    diff = unified_diff(a, b, "v1", "v2")
    assert "RB-OLD" in diff and "RB-NEW" in diff
    assert "15:54:38" not in diff



def test_schema_accepts_minimal():
    m = NasManagerCreate(conn_type="ssh", username="admin", password="pw")
    assert m.host is None and m.port is None


@pytest.mark.parametrize("bad", [
    {"conn_type": "carrier-pigeon", "username": "admin"},
    {"conn_type": "ssh", "username": "bad user!"},
    {"conn_type": "ssh", "username": "admin", "port": 70000},
    {"conn_type": "ssh", "username": "admin", "host": "has space"},
])
def test_schema_rejects_bad(bad):
    with pytest.raises(Exception):
        NasManagerCreate(**bad)



@pytest.mark.asyncio
async def test_nas_manager_requires_auth(client):
    r = await client.get("/api/nas-manager")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_vendor_types_endpoint(superadmin_client):
    r = await superadmin_client.get("/api/nas-manager/vendor-types")
    assert r.status_code == 200
    vendors = {v["vendor"] for v in r.json()}
    assert {"mikrotik", "cisco", "huawei"} <= vendors
