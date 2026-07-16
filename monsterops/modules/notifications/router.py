from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import get_current_user, require_roles
from monsterops.modules.notifications.channels import dispatch
from monsterops.modules.notifications.models import (
    NotificationChannel,
    NotificationHistory,
    NotificationRule,
)
from monsterops.modules.notifications.schemas import (
    ChannelCreate,
    ChannelOut,
    ChannelUpdate,
    HistoryOut,
    RuleCreate,
    RuleOut,
    RuleUpdate,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

_ADMIN = Depends(require_roles("superadmin", "admin"))
_ANY = Depends(get_current_user)




@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(db: AsyncSession = Depends(get_db), _u=_ANY):
    q = await db.execute(select(NotificationChannel).order_by(NotificationChannel.name))
    return [ChannelOut.model_validate(r) for r in q.scalars().all()]


@router.post("/channels", response_model=ChannelOut, status_code=201)
async def create_channel(body: ChannelCreate, db: AsyncSession = Depends(get_db), _u=_ADMIN):
    if body.type not in ("email", "webhook"):
        raise HTTPException(400, "type must be 'email' or 'webhook'")
    ch = NotificationChannel(**body.model_dump())
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return ChannelOut.model_validate(ch)


@router.get("/channels/{channel_id}", response_model=ChannelOut)
async def get_channel(channel_id: int, db: AsyncSession = Depends(get_db), _u=_ANY):
    ch = await db.get(NotificationChannel, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    return ChannelOut.model_validate(ch)


@router.put("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: int, body: ChannelUpdate, db: AsyncSession = Depends(get_db), _u=_ADMIN
):
    ch = await db.get(NotificationChannel, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(ch, field, value)
    ch.updated_at = datetime.now(tz=timezone.utc)
    await db.commit()
    await db.refresh(ch)
    return ChannelOut.model_validate(ch)


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(channel_id: int, db: AsyncSession = Depends(get_db), _u=_ADMIN):
    ch = await db.get(NotificationChannel, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    await db.delete(ch)
    await db.commit()


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: int, db: AsyncSession = Depends(get_db), _u=_ADMIN):
    ch = await db.get(NotificationChannel, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    ok, err = await dispatch(
        ch.type,
        ch.config or {},
        "[MonsterOps] Test notification",
        "This is a test notification from MonsterOps. If you received this, the channel is configured correctly.",
    )
    if not ok:
        raise HTTPException(502, f"Send failed: {err}")
    return {"status": "sent"}



_VALID_EVENT_TYPES = {"auth_failure", "nas_offline", "system_health"}


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(db: AsyncSession = Depends(get_db), _u=_ANY):
    q = await db.execute(select(NotificationRule).order_by(NotificationRule.name))
    return [RuleOut.model_validate(r) for r in q.scalars().all()]


@router.post("/rules", response_model=RuleOut, status_code=201)
async def create_rule(body: RuleCreate, db: AsyncSession = Depends(get_db), _u=_ADMIN):
    if body.event_type not in _VALID_EVENT_TYPES:
        raise HTTPException(
            400, f"event_type must be one of: {', '.join(sorted(_VALID_EVENT_TYPES))}"
        )
    rule = NotificationRule(**body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return RuleOut.model_validate(rule)


@router.get("/rules/{rule_id}", response_model=RuleOut)
async def get_rule(rule_id: int, db: AsyncSession = Depends(get_db), _u=_ANY):
    rule = await db.get(NotificationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    return RuleOut.model_validate(rule)


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: int, body: RuleUpdate, db: AsyncSession = Depends(get_db), _u=_ADMIN
):
    rule = await db.get(NotificationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    data = body.model_dump(exclude_none=True)
    if "event_type" in data and data["event_type"] not in _VALID_EVENT_TYPES:
        raise HTTPException(
            400, f"event_type must be one of: {', '.join(sorted(_VALID_EVENT_TYPES))}"
        )
    for field, value in data.items():
        setattr(rule, field, value)
    rule.updated_at = datetime.now(tz=timezone.utc)
    await db.commit()
    await db.refresh(rule)
    return RuleOut.model_validate(rule)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db), _u=_ADMIN):
    rule = await db.get(NotificationRule, rule_id)
    if not rule:
        raise HTTPException(404, "Rule not found")
    await db.delete(rule)
    await db.commit()




@router.get("/history", response_model=list[HistoryOut])
async def list_history(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    event_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _u=_ANY,
):
    stmt = select(NotificationHistory).order_by(NotificationHistory.created_at.desc())
    if status:
        stmt = stmt.where(NotificationHistory.status == status)
    if event_type:
        stmt = stmt.where(NotificationHistory.event_type == event_type)
    stmt = stmt.limit(limit).offset(offset)
    q = await db.execute(stmt)
    return [HistoryOut.model_validate(r) for r in q.scalars().all()]
