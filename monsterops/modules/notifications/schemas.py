from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ChannelCreate(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = {}
    enabled: bool = True


class ChannelUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    config: dict[str, Any]
    enabled: bool
    created_at: datetime
    updated_at: datetime


class RuleCreate(BaseModel):
    name: str
    event_type: str
    config: dict[str, Any] = {}
    channel_id: int | None = None
    cooldown_minutes: int = 60
    enabled: bool = True


class RuleUpdate(BaseModel):
    name: str | None = None
    event_type: str | None = None
    config: dict[str, Any] | None = None
    channel_id: int | None = None
    cooldown_minutes: int | None = None
    enabled: bool | None = None


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    event_type: str
    config: dict[str, Any]
    channel_id: int | None
    cooldown_minutes: int
    enabled: bool
    last_triggered: datetime | None
    created_at: datetime
    updated_at: datetime


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rule_id: int | None
    rule_name: str | None
    channel_id: int | None
    channel_name: str | None
    event_type: str
    subject: str
    message: str
    status: str
    error: str | None
    created_at: datetime
