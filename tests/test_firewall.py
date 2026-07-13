from __future__ import annotations

import uuid

import pytest

from monsterops.modules.firewall import presets, validators as V
from monsterops.modules.firewall.generator import generate_ruleset
from monsterops.modules.firewall.validators import FirewallValidationError



def test_validate_addr_accepts_ip_and_cidr():
    assert V.validate_addr("10.0.0.1") == "10.0.0.1"
    assert V.validate_addr("192.168.0.0/24") == "192.168.0.0/24"
    assert V.validate_addr("2001:db8::/32") == "2001:db8::/32"


@pytest.mark.parametrize("bad", ["not-an-ip", "10.0.0.0/999", "1.2.3.4; drop", ""])
def test_validate_addr_rejects_junk(bad):
    with pytest.raises(FirewallValidationError):
        V.validate_addr(bad)


def test_validate_ports_forms():
    assert V.validate_ports("1812")
    assert V.validate_ports("1812-1813")
    assert V.validate_ports("1812,1813,3799")


@pytest.mark.parametrize("bad", ["0", "70000", "1813-1812", "abc", "22;rm", "-1"])
def test_validate_ports_rejects(bad):
    with pytest.raises(FirewallValidationError):
        V.validate_ports(bad)


@pytest.mark.parametrize("bad", ["Bad Name", "1name", "name!", "x" * 60])
def test_validate_name_rejects(bad):
    with pytest.raises(FirewallValidationError):
        V.validate_name(bad)


def test_validate_ct_state():
    assert V.validate_ct_state("established,related")
    with pytest.raises(FirewallValidationError):
        V.validate_ct_state("established,bogus")


def test_validate_choice():
    assert V.validate_choice("drop", V.ACTIONS, "action") == "drop"
    with pytest.raises(FirewallValidationError):
        V.validate_choice("mangle", V.ACTIONS, "action")



class _Cfg:
    default_input_policy = "drop"
    default_forward_policy = "drop"
    allow_ping = True
    ssh_guard_port = 22
    web_guard_port = 8000


class _Rule:
    def __init__(self, **kw):
        defaults = dict(enabled=True, chain="input", action="accept", protocol=None,
                        saddr=None, daddr=None, sport=None, dport=None, iifname=None,
                        oifname=None, ct_state=None, src_set=None, comment=None)
        defaults.update(kw)
        self.__dict__.update(defaults)


class _Set:
    def __init__(self, name, kind="block", family="ipv4_addr", elements=()):
        self.name, self.kind, self.family = name, kind, family
        self.entries = [type("E", (), {"element": e})() for e in elements]


def test_generator_has_atomic_replace_and_table():
    rs = generate_ruleset(_Cfg(), [], [])
    assert rs.startswith("add table inet monsterops\ndelete table inet monsterops\n")
    assert "table inet monsterops {" in rs


def test_generator_injects_guard_rules_on_drop():
    rs = generate_ruleset(_Cfg(), [], [])
    assert 'iif "lo" accept' in rs
    assert "ct state established,related accept" in rs
    assert 'tcp dport 22 counter accept comment "guard: ssh"' in rs
    assert 'tcp dport 8000 counter accept comment "guard: monsterops ui"' in rs


def test_generator_admin_guard_ip():
    rs = generate_ruleset(_Cfg(), [], [], guard_ips=["203.0.113.9"])
    assert 'ip saddr 203.0.113.9 counter accept comment "guard: admin session"' in rs


def test_generator_port_rule_has_no_redundant_l4proto():
    rs = generate_ruleset(_Cfg(), [_Rule(protocol="tcp", dport="22", comment="ssh")], [])
    assert "tcp dport 22 counter accept" in rs
    assert "meta l4proto tcp tcp dport" not in rs


def test_generator_protocol_without_port_keeps_l4proto():
    rs = generate_ruleset(_Cfg(), [_Rule(protocol="udp", comment="all udp")], [])
    assert "meta l4proto udp" in rs


def test_generator_port_list_expr():
    rs = generate_ruleset(_Cfg(), [_Rule(protocol="udp", dport="1812,1813")], [])
    assert "udp dport { 1812, 1813 }" in rs


def test_generator_block_set_autorule():
    rs = generate_ruleset(_Cfg(), [], [_Set("blocklist", "block", elements=["203.0.113.4"])])
    assert "set blocklist {" in rs
    assert "203.0.113.4" in rs
    assert 'ip saddr @blocklist counter drop comment "blocklist: blocklist"' in rs


def test_generator_disabled_rule_excluded():
    rs = generate_ruleset(_Cfg(), [_Rule(protocol="tcp", dport="9999", enabled=False)], [])
    assert "9999" not in rs


def test_generator_rejects_injection_in_addr():
    with pytest.raises(FirewallValidationError):
        generate_ruleset(_Cfg(), [_Rule(saddr="1.2.3.4 accept; drop")], [])



def test_preset_radius_ports():
    rules = presets.preset_rules("radius")
    assert rules[0]["dport"] == "1812,1813"
    assert rules[0]["protocol"] == "udp"


def test_preset_src_set_scoping():
    rules = presets.preset_rules("radius", src_set="trusted")
    assert all(r["src_set"] == "trusted" for r in rules)


def test_preset_unknown_raises():
    with pytest.raises(KeyError):
        presets.preset_rules("does-not-exist")



@pytest.mark.asyncio
async def test_firewall_config_requires_auth(client):
    r = await client.get("/api/firewall/config")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_firewall_readonly_cannot_write(readonly_client):
    r = await readonly_client.post("/api/firewall/rules", json={
        "chain": "input", "action": "accept", "protocol": "tcp", "dport": "22"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_firewall_rule_roundtrip(superadmin_client):
    comment = f"test-{uuid.uuid4().hex[:8]}"
    r = await superadmin_client.post("/api/firewall/rules", json={
        "chain": "input", "action": "accept", "protocol": "udp", "dport": "1812", "comment": comment})
    assert r.status_code == 201
    rid = r.json()["id"]
    try:
        listed = (await superadmin_client.get("/api/firewall/rules")).json()
        assert any(x["id"] == rid and x["comment"] == comment for x in listed)
        bad = await superadmin_client.post("/api/firewall/rules", json={"saddr": "not-an-ip"})
        assert bad.status_code == 422
    finally:
        await superadmin_client.delete(f"/api/firewall/rules/{rid}")



@pytest.mark.asyncio
async def test_autoblock_config_validation(superadmin_client):
    base = (await superadmin_client.get("/api/firewall/config")).json()
    base.pop("last_applied_at", None)
    r1 = await superadmin_client.put("/api/firewall/config", json={**base, "autoblock_threshold": 1})
    assert r1.status_code == 422
    r2 = await superadmin_client.put("/api/firewall/config", json={**base, "autoblock_window": 5000})
    assert r2.status_code == 422
    r3 = await superadmin_client.put("/api/firewall/config", json={**base, "autoblock_ban_seconds": 30})
    assert r3.status_code == 422


@pytest.mark.asyncio
async def test_autoblock_bans_over_threshold(superadmin_client):
    from datetime import datetime, timezone

    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.auth_logs.models import Radpostauth
    from monsterops.modules.firewall.worker import run_autoblock_cycle

    base = (await superadmin_client.get("/api/firewall/config")).json()
    base.pop("last_applied_at", None)

    attacker = "203.0.113.66"
    slow = "198.51.100.7"
    mac = "AA:BB:CC:DD:EE:FF"
    marker = f"e2e-{uuid.uuid4().hex[:8]}"

    r = await superadmin_client.put("/api/firewall/config", json={
        **base, "autoblock_enabled": True, "autoblock_threshold": 3,
        "autoblock_window": 60, "autoblock_ban_seconds": 60})
    assert r.status_code == 200
    assert r.json()["autoblock_enabled"] is True

    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        for station, n in ((attacker, 4), (slow, 2), (mac, 5)):
            for _ in range(n):
                db.add(Radpostauth(username=marker, reply="Access-Reject",
                                   callingstationid=station, authdate=now))
        await db.commit()

    set_id = None
    try:
        assert await run_autoblock_cycle() >= 1

        sets = (await superadmin_client.get("/api/firewall/sets")).json()
        auto = next(s for s in sets if s["auto_ban"])
        set_id = auto["id"]
        elems = {e["element"] for e in auto["entries"]}
        assert attacker in elems
        assert slow not in elems and mac not in elems
        entry = next(e for e in auto["entries"] if e["element"] == attacker)
        assert entry["expires_at"] is not None
        count_after_first = len(auto["entries"])

        await run_autoblock_cycle()
        auto2 = next(s for s in (await superadmin_client.get("/api/firewall/sets")).json() if s["auto_ban"])
        assert len(auto2["entries"]) == count_after_first
    finally:
        async with SessionLocal() as db:
            await db.execute(text("DELETE FROM radpostauth WHERE username = :u"), {"u": marker})
            await db.commit()
        if set_id is not None:
            await superadmin_client.delete(f"/api/firewall/sets/{set_id}")
        await superadmin_client.put("/api/firewall/config", json=base)


@pytest.mark.asyncio
async def test_autoblock_records_event_and_manual_override(superadmin_client):
    from datetime import datetime, timezone

    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.auth_logs.models import Radpostauth
    from monsterops.modules.firewall.worker import run_autoblock_cycle

    base = (await superadmin_client.get("/api/firewall/config")).json()
    base.pop("last_applied_at", None)

    attacker = "203.0.113.99"
    marker = f"e2e-{uuid.uuid4().hex[:8]}"

    r = await superadmin_client.put("/api/firewall/config", json={
        **base, "autoblock_enabled": True, "autoblock_threshold": 3,
        "autoblock_window": 60, "autoblock_ban_seconds": 120})
    assert r.status_code == 200

    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        for _ in range(4):
            db.add(Radpostauth(username=marker, reply="Access-Reject",
                               callingstationid=attacker, authdate=now))
        await db.commit()

    set_id = None
    try:
        assert await run_autoblock_cycle() >= 1

        events = (await superadmin_client.get("/api/firewall/block-events")).json()
        ev = next(e for e in events if e["element"] == attacker)
        assert ev["source"] == "brute_force"
        assert "reject" in (ev["reason"] or "")
        assert ev["set_name"] == "mr_autoblock"
        assert ev["ban_seconds"] == 120
        assert ev["override_by"] is None and ev["override_at"] is None

        auto = next(s for s in (await superadmin_client.get("/api/firewall/sets")).json() if s["auto_ban"])
        set_id = auto["id"]
        entry = next(e for e in auto["entries"] if e["element"] == attacker)
        d = await superadmin_client.delete(f"/api/firewall/sets/{set_id}/entries/{entry['id']}")
        assert d.status_code == 204

        events2 = (await superadmin_client.get("/api/firewall/block-events")).json()
        ev2 = next(e for e in events2 if e["element"] == attacker)
        assert ev2["override_by"] == "testadmin"
        assert ev2["override_at"] is not None
    finally:
        async with SessionLocal() as db:
            await db.execute(text("DELETE FROM radpostauth WHERE username = :u"), {"u": marker})
            await db.execute(text("DELETE FROM mr_firewall_block_event WHERE element = :e"), {"e": attacker})
            await db.commit()
        if set_id is not None:
            await superadmin_client.delete(f"/api/firewall/sets/{set_id}")
        await superadmin_client.put("/api/firewall/config", json=base)


@pytest.mark.asyncio
async def test_block_events_readable_by_readonly(readonly_client):
    r = await readonly_client.get("/api/firewall/block-events?limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)



def test_geoblock_parse_zone_filters():
    from monsterops.modules.firewall import geoblock
    text = "1.2.3.0/24\n# a comment\n\n2001:db8::/32\nnot-an-ip\n5.6.7.0/24\n"
    assert geoblock._parse_zone(text) == ["1.2.3.0/24", "5.6.7.0/24"]


def test_geoblock_normalize_cc():
    from monsterops.modules.firewall import geoblock
    assert geoblock.normalize_cc(" cn ") == "CN"
    assert geoblock.set_name_for("CN") == "mr_country_cn"
    for bad in ("USA", "1", "u2", ""):
        with pytest.raises(geoblock.CountryBlockError):
            geoblock.normalize_cc(bad)


@pytest.mark.asyncio
async def test_country_block_validation(superadmin_client):
    for bad in ("X", "12", "USA"):
        r = await superadmin_client.post("/api/firewall/country-block", json={"country_code": bad})
        assert r.status_code == 422, bad


@pytest.mark.asyncio
async def test_country_block_disable_toggle(superadmin_client, monkeypatch):
    from monsterops.config import settings
    monkeypatch.setattr(settings, "firewall_country_block_enabled", False)
    r = await superadmin_client.post("/api/firewall/country-block", json={"country_code": "AD"})
    assert r.status_code == 400 and "disabled" in r.text.lower()


@pytest.mark.asyncio
async def test_country_block_builds_and_refreshes_managed_set(superadmin_client, monkeypatch):
    from monsterops.modules.firewall import geoblock

    async def fake_fetch(cc):
        assert cc == "AD"
        return ["1.2.3.0/24", "5.6.0.0/16"]
    monkeypatch.setattr(geoblock, "fetch_country_cidrs", fake_fetch)

    try:
        r = await superadmin_client.post("/api/firewall/country-block", json={"country_code": "ad"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["country"] == "AD" and body["count"] == 2 and body["name"] == "mr_country_ad"

        sets = (await superadmin_client.get("/api/firewall/sets")).json()
        cs = next(s for s in sets if s["name"] == "mr_country_ad")
        assert cs["managed_source"] == "country:AD" and cs["kind"] == "block"
        assert {e["element"] for e in cs["entries"]} == {"1.2.3.0/24", "5.6.0.0/16"}

        bad = await superadmin_client.post(
            f"/api/firewall/sets/{cs['id']}/entries", json={"element": "9.9.9.9"})
        assert bad.status_code == 409

        async def fake_fetch2(cc):
            return ["10.0.0.0/8"]
        monkeypatch.setattr(geoblock, "fetch_country_cidrs", fake_fetch2)
        r3 = await superadmin_client.post("/api/firewall/country-block", json={"country_code": "AD"})
        assert r3.json()["count"] == 1
        cs = next(s for s in (await superadmin_client.get("/api/firewall/sets")).json()
                  if s["name"] == "mr_country_ad")
        assert {e["element"] for e in cs["entries"]} == {"10.0.0.0/8"}
    finally:
        await superadmin_client.delete("/api/firewall/country-block/AD")

    sets = (await superadmin_client.get("/api/firewall/sets")).json()
    assert not any(s["name"] == "mr_country_ad" for s in sets)



def test_generator_allow_only_emits_accept_and_guards():
    from monsterops.modules.firewall.models import (
        MrFirewallConfig,
        MrFirewallSet,
        MrFirewallSetEntry,
    )
    cfg = MrFirewallConfig(default_input_policy="drop", default_forward_policy="drop",
                           allow_ping=True, ssh_guard_port=22, web_guard_port=8000)
    allow = MrFirewallSet(name="mr_country_allow_br", family="ipv4_addr", kind="allow",
                          managed_source="country_allow:BR")
    allow.entries = [MrFirewallSetEntry(element="200.0.0.0/8")]
    guard = MrFirewallSet(name="mr_guard_nas", family="ipv4_addr", kind="allow",
                          managed_source="guard:nas")
    guard.entries = [MrFirewallSetEntry(element="10.0.0.1")]
    rs = generate_ruleset(cfg, [], [allow, guard], guard_ips=["203.0.113.5"])
    assert "policy drop;" in rs
    assert "ip saddr @mr_country_allow_br counter accept" in rs
    assert "ip saddr @mr_guard_nas counter accept" in rs
    assert 'comment "guard: ssh"' in rs and 'comment "guard: monsterops ui"' in rs
    assert 'iif "lo" accept' in rs
    assert "ct state established,related accept" in rs
    assert "203.0.113.5" in rs


@pytest.mark.asyncio
async def test_country_allow_only_validation(superadmin_client):
    for bad in ("X", "12", "USA"):
        r = await superadmin_client.post("/api/firewall/country-allow-only", json={"country_code": bad})
        assert r.status_code == 422, bad


@pytest.mark.asyncio
async def test_country_allow_only_guard_and_policy(superadmin_client, monkeypatch):
    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.firewall import geoblock
    from monsterops.modules.nas.models import Nas

    async def fake_fetch(cc):
        assert cc == "BR"
        return ["200.0.0.0/8", "201.0.0.0/16"]
    monkeypatch.setattr(geoblock, "fetch_country_cidrs", fake_fetch)

    base = (await superadmin_client.get("/api/firewall/config")).json()
    base.pop("last_applied_at", None)

    nas_ip = "192.0.2.200"
    async with SessionLocal() as db:
        db.add(Nas(nasname=nas_ip, shortname="e2e-nas-ip", type="other", secret="x"))
        db.add(Nas(nasname="radius.example.test", shortname="e2e-nas-host", type="other", secret="x"))
        await db.commit()

    try:
        r = await superadmin_client.post("/api/firewall/country-allow-only", json={"country_code": "br"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["country"] == "BR" and body["count"] == 2
        assert body["input_policy"] == "drop" and body["applied"] is False
        assert body["nas_guard"]["count"] >= 1 and body["nas_guard"]["skipped"] >= 1
        assert "DROP" in body["warning"]

        sets = (await superadmin_client.get("/api/firewall/sets")).json()
        allow = next(s for s in sets if s["name"] == "mr_country_allow_br")
        assert allow["kind"] == "allow" and allow["managed_source"] == "country_allow:BR"
        guard = next(s for s in sets if s["name"] == "mr_guard_nas")
        guard_els = {e["element"] for e in guard["entries"]}
        assert nas_ip in guard_els and "radius.example.test" not in guard_els

        cfg = (await superadmin_client.get("/api/firewall/config")).json()
        assert cfg["default_input_policy"] == "drop"

        rs = (await superadmin_client.get("/api/firewall/preview")).json()["ruleset"]
        assert "ip saddr @mr_country_allow_br counter accept" in rs
        assert "ip saddr @mr_guard_nas counter accept" in rs
        assert "policy drop;" in rs

        bad = await superadmin_client.post(
            f"/api/firewall/sets/{guard['id']}/entries", json={"element": "9.9.9.9"})
        assert bad.status_code == 409

        d = await superadmin_client.delete("/api/firewall/country-allow-only/BR")
        assert d.status_code == 204
        sets2 = (await superadmin_client.get("/api/firewall/sets")).json()
        assert not any(s["name"] == "mr_country_allow_br" for s in sets2)
        assert not any(s["name"] == "mr_guard_nas" for s in sets2)
        cfg2 = (await superadmin_client.get("/api/firewall/config")).json()
        assert cfg2["default_input_policy"] == "accept"
    finally:
        await superadmin_client.delete("/api/firewall/country-allow-only/BR")
        async with SessionLocal() as db:
            await db.execute(text("DELETE FROM nas WHERE shortname IN ('e2e-nas-ip','e2e-nas-host')"))
            await db.commit()
        await superadmin_client.put("/api/firewall/config", json=base)



@pytest.mark.asyncio
async def test_find_lockout_ips_cidr_containment():
    from monsterops.database import SessionLocal
    from monsterops.modules.firewall.service import find_lockout_ips

    async with SessionLocal() as db:
        res = await find_lockout_ips(db, ["10.1.0.0/16"], current_ip="10.1.2.3")
        assert any(c["current"] and c["ip"] == "10.1.2.3" for c in res["covered"])

        res2 = await find_lockout_ips(db, ["198.51.100.0/24"], current_ip="10.1.2.3")
        assert "10.1.2.3" not in {c["ip"] for c in res2["covered"]}

        res3 = await find_lockout_ips(db, ["127.0.0.0/8"], current_ip="127.0.0.1")
        assert "127.0.0.1" not in {c["ip"] for c in res3["covered"]}

        res4 = await find_lockout_ips(db, ["not-an-ip"], current_ip="10.1.2.3")
        assert not any(c["current"] for c in res4["covered"])


@pytest.mark.asyncio
async def test_block_preflight_flags_prior_access_ip(superadmin_client):
    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.auth.models import AuditLog

    prior = "203.0.113.77"
    async with SessionLocal() as db:
        db.add(AuditLog(admin_username="e2e-pf", action="test.preflight", ip_address=prior))
        await db.commit()
    try:
        r = await superadmin_client.post(
            "/api/firewall/block-preflight", json={"elements": ["203.0.113.0/24"]})
        assert r.status_code == 200
        assert prior in {c["ip"] for c in r.json()["covered"]}

        r2 = await superadmin_client.post(
            "/api/firewall/block-preflight", json={"elements": ["198.51.100.0/24"]})
        assert prior not in {c["ip"] for c in r2.json()["covered"]}

        r3 = await superadmin_client.post(
            "/api/firewall/block-preflight", json={"elements": [prior]})
        assert prior in {c["ip"] for c in r3.json()["covered"]}
    finally:
        async with SessionLocal() as db:
            await db.execute(text("DELETE FROM audit_log WHERE action='test.preflight'"))
            await db.commit()


@pytest.mark.asyncio
async def test_find_lockout_ips_flags_configured_nas():
    from sqlalchemy import text

    from monsterops.database import SessionLocal
    from monsterops.modules.firewall.service import find_lockout_ips
    from monsterops.modules.nas.models import Nas

    async with SessionLocal() as db:
        db.add(Nas(nasname="192.0.2.50", shortname="pf-nas-host", type="mikrotik", secret="s"))
        db.add(Nas(nasname="10.9.0.0/24", shortname="pf-nas-net", type="other", secret="s"))
        db.add(Nas(nasname="nas.example.test", shortname="pf-nas-name", type="other", secret="s"))
        await db.commit()
    try:
        async with SessionLocal() as db:
            r1 = await find_lockout_ips(db, ["192.0.2.0/24"])
            assert "192.0.2.50" in {n["ip"] for n in r1["nas"]}

            r2 = await find_lockout_ips(db, ["10.9.0.128/25"])
            assert "10.9.0.0/24" in {n["ip"] for n in r2["nas"]}

            r3 = await find_lockout_ips(db, ["0.0.0.0/0"])
            assert "nas.example.test" not in {n["ip"] for n in r3["nas"]}
            assert {"192.0.2.50", "10.9.0.0/24"} <= {n["ip"] for n in r3["nas"]}

            r4 = await find_lockout_ips(db, ["172.31.0.0/16"])
            hit = {n["ip"] for n in r4["nas"]}
            assert "192.0.2.50" not in hit and "10.9.0.0/24" not in hit
    finally:
        async with SessionLocal() as db:
            await db.execute(text(
                "DELETE FROM nas WHERE shortname IN ('pf-nas-host','pf-nas-net','pf-nas-name')"))
            await db.commit()
