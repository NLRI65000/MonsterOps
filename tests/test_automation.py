from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from monsterops.modules.automation.engine import _VALID_ACTIONS, _condition_match


def _event(**kw):
    base = dict(type="user.created", actor="admin", entity_type="user", entity_id="42", data={})
    base.update(kw)
    return SimpleNamespace(**base)



def test_empty_conditions_always_match():
    assert _condition_match(_event(), []) is True


def test_eq_and_neq():
    ev = _event(type="user.deleted")
    assert _condition_match(ev, [{"field": "type", "op": "eq", "value": "user.deleted"}])
    assert not _condition_match(ev, [{"field": "type", "op": "eq", "value": "user.created"}])
    assert _condition_match(ev, [{"field": "type", "op": "neq", "value": "user.created"}])


def test_contains_startswith_endswith():
    ev = _event(type="nas.updated")
    assert _condition_match(ev, [{"field": "type", "op": "contains", "value": "nas"}])
    assert _condition_match(ev, [{"field": "type", "op": "startswith", "value": "nas."}])
    assert _condition_match(ev, [{"field": "type", "op": "endswith", "value": "updated"}])


def test_regex_and_data_field():
    ev = _event(type="user.created", data={"role": "superadmin"})
    assert _condition_match(ev, [{"field": "type", "op": "regex", "value": r"user\.(created|deleted)"}])
    assert _condition_match(ev, [{"field": "role", "op": "eq", "value": "superadmin"}])
    assert not _condition_match(ev, [{"field": "role", "op": "eq", "value": "readonly"}])


def test_multiple_conditions_are_anded():
    ev = _event(type="user.created", actor="alice")
    conds = [
        {"field": "type", "op": "eq", "value": "user.created"},
        {"field": "actor", "op": "eq", "value": "alice"},
    ]
    assert _condition_match(ev, conds)
    conds[1]["value"] = "bob"
    assert not _condition_match(ev, conds)


def test_firewall_ban_is_a_valid_action():
    assert "firewall_ban" in _VALID_ACTIONS



@pytest.mark.asyncio
async def test_automation_requires_auth(client):
    assert (await client.get("/api/automation")).status_code == 401


@pytest.mark.asyncio
async def test_automation_rejects_unknown_action(superadmin_client):
    r = await superadmin_client.post("/api/automation", json={
        "name": "bad", "event_pattern": "user.*", "action_type": "nuke_everything"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_automation_rule_roundtrip(superadmin_client):
    name = f"rule-{uuid.uuid4().hex[:8]}"
    r = await superadmin_client.post("/api/automation", json={
        "name": name, "event_pattern": "user.created", "action_type": "log",
        "conditions": [{"field": "actor", "op": "eq", "value": "admin"}]})
    assert r.status_code in (200, 201), r.text
    rid = r.json()["id"]
    try:
        listed = (await superadmin_client.get("/api/automation")).json()
        assert any(x["id"] == rid for x in listed)
        t = await superadmin_client.post(f"/api/automation/{rid}/test")
        assert t.status_code in (200, 202, 204)
    finally:
        await superadmin_client.delete(f"/api/automation/{rid}")
