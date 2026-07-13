from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import require_roles
from monsterops.modules.webhooks.models import MrWebhookSub

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

_sse_queues: list[asyncio.Queue[dict[str, Any]]] = []



class WebhookSubIn(BaseModel):
    name: str
    url: HttpUrl
    secret: str | None = None
    events: list[str]
    enabled: bool = True


class WebhookSubOut(BaseModel):
    id: int
    name: str
    url: str
    has_secret: bool
    events: list[str]
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}



@router.get("")
async def list_subs(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> list[WebhookSubOut]:
    result = await db.execute(select(MrWebhookSub).order_by(MrWebhookSub.id))
    subs = result.scalars().all()
    return [
        WebhookSubOut(
            id=s.id,
            name=str(s.name),
            url=str(s.url),
            has_secret=bool(s.secret),
            events=list(s.events or []),
            enabled=bool(s.enabled),
            created_at=s.created_at,
        )
        for s in subs
    ]


@router.post("", status_code=201)
async def create_sub(
    body: WebhookSubIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> WebhookSubOut:
    sub = MrWebhookSub(
        name=body.name,
        url=str(body.url),
        secret=body.secret,
        events=body.events,
        enabled=body.enabled,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return WebhookSubOut(
        id=sub.id,
        name=str(sub.name),
        url=str(sub.url),
        has_secret=bool(sub.secret),
        events=list(sub.events or []),
        enabled=bool(sub.enabled),
        created_at=sub.created_at,
    )



@router.get("/{sub_id}")
async def get_sub(
    sub_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> WebhookSubOut:
    sub = await db.get(MrWebhookSub, sub_id)
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    return WebhookSubOut(
        id=sub.id,
        name=str(sub.name),
        url=str(sub.url),
        has_secret=bool(sub.secret),
        events=list(sub.events or []),
        enabled=bool(sub.enabled),
        created_at=sub.created_at,
    )


@router.put("/{sub_id}")
async def update_sub(
    sub_id: int,
    body: WebhookSubIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> WebhookSubOut:
    sub = await db.get(MrWebhookSub, sub_id)
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    sub.name = body.name
    sub.url = str(body.url)
    if body.secret is not None:
        sub.secret = body.secret
    sub.events = body.events
    sub.enabled = body.enabled
    await db.commit()
    await db.refresh(sub)
    return WebhookSubOut(
        id=sub.id,
        name=str(sub.name),
        url=str(sub.url),
        has_secret=bool(sub.secret),
        events=list(sub.events or []),
        enabled=bool(sub.enabled),
        created_at=sub.created_at,
    )


@router.delete("/{sub_id}", status_code=204)
async def delete_sub(
    sub_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> None:
    sub = await db.get(MrWebhookSub, sub_id)
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    await db.delete(sub)
    await db.commit()


@router.post("/{sub_id}/test", status_code=202)
async def test_sub(
    sub_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
) -> dict[str, str]:
    from monsterops.events import Event, fire

    sub = await db.get(MrWebhookSub, sub_id)
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")

    test_event = Event(
        type="test.ping",
        actor="system",
        entity_type="webhook",
        entity_id=str(sub_id),
        data={"message": "MonsterOps test delivery", "subscription_name": str(sub.name)},
    )
    asyncio.create_task(fire(test_event))
    return {"status": "queued", "subscription": str(sub.name)}



@router.get("/stream/events")
async def event_stream(
    _user=Depends(require_roles("superadmin", "admin")),
) -> StreamingResponse:
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
    _sse_queues.append(q)

    async def _generate():
        try:
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                try:
                    event_dict = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(event_dict)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            try:
                _sse_queues.remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def push_to_sse(event_dict: dict[str, Any]) -> None:
    for q in list(_sse_queues):
        try:
            q.put_nowait(event_dict)
        except asyncio.QueueFull:
            pass
