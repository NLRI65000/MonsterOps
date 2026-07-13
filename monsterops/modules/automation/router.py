from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import require_roles
from monsterops.modules.automation.models import MrAutomationRule

router = APIRouter(prefix="/api/automation", tags=["automation"])

_VALID_ACTIONS = ["log", "notify_webhook", "disable_user",
                  "add_to_group", "remove_from_group", "send_email"]
_VALID_OPS = ["eq", "neq", "contains", "startswith", "endswith", "regex"]


class ConditionIn(BaseModel):
    field: str
    op: str
    value: str


class RuleIn(BaseModel):
    name: str
    event_pattern: str
    conditions: list[ConditionIn] = []
    action_type: str
    action_config: dict[str, Any] = {}
    enabled: bool = True


class RuleOut(BaseModel):
    id: int
    name: str
    event_pattern: str
    conditions: list[dict]
    action_type: str
    action_config: dict[str, Any]
    enabled: bool
    created_at: datetime
    last_triggered_at: datetime | None
    trigger_count: int

    model_config = {"from_attributes": True}


def _to_out(r: MrAutomationRule) -> RuleOut:
    return RuleOut(
        id=r.id,
        name=str(r.name),
        event_pattern=str(r.event_pattern),
        conditions=list(r.conditions or []),
        action_type=str(r.action_type),
        action_config=dict(r.action_config or {}),
        enabled=bool(r.enabled),
        created_at=r.created_at,
        last_triggered_at=r.last_triggered_at,
        trigger_count=int(r.trigger_count or 0),
    )


@router.get("")
async def list_rules(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> list[RuleOut]:
    result = await db.execute(select(MrAutomationRule).order_by(MrAutomationRule.id))
    return [_to_out(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_rule(
    body: RuleIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> RuleOut:
    if body.action_type not in _VALID_ACTIONS:
        raise HTTPException(400, f"Unknown action_type. Valid: {_VALID_ACTIONS}")
    for c in body.conditions:
        if c.op not in _VALID_OPS:
            raise HTTPException(400, f"Unknown condition op '{c.op}'. Valid: {_VALID_OPS}")
    rule = MrAutomationRule(
        name=body.name,
        event_pattern=body.event_pattern,
        conditions=[c.model_dump() for c in body.conditions],
        action_type=body.action_type,
        action_config=body.action_config,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _to_out(rule)


@router.get("/{rule_id}")
async def get_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> RuleOut:
    rule = await db.get(MrAutomationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    return _to_out(rule)


@router.put("/{rule_id}")
async def update_rule(
    rule_id: int,
    body: RuleIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> RuleOut:
    rule = await db.get(MrAutomationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    if body.action_type not in _VALID_ACTIONS:
        raise HTTPException(400, f"Unknown action_type. Valid: {_VALID_ACTIONS}")
    rule.name = body.name
    rule.event_pattern = body.event_pattern
    rule.conditions = [c.model_dump() for c in body.conditions]
    rule.action_type = body.action_type
    rule.action_config = body.action_config
    rule.enabled = body.enabled
    await db.commit()
    await db.refresh(rule)
    return _to_out(rule)


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> None:
    rule = await db.get(MrAutomationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    await db.delete(rule)
    await db.commit()


@router.post("/{rule_id}/test", status_code=202)
async def test_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> dict[str, str]:
    from monsterops.events import Event, fire

    rule = await db.get(MrAutomationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")

    test_event = Event(
        type="test.ping",
        actor="system",
        entity_type="automation",
        entity_id=str(rule_id),
        data={"message": "Automation rule test", "rule_name": str(rule.name)},
    )
    asyncio.create_task(fire(test_event))
    return {"status": "queued", "rule": str(rule.name)}
