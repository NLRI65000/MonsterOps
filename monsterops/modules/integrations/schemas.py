from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class IntegrationCreate(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = {}
    enabled: bool = True


class IntegrationUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class IntegrationOut(BaseModel):
    id: int
    name: str
    type: str
    config: dict[str, Any]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TestResult(BaseModel):
    ok: bool
    message: str
    detail: dict[str, Any] = {}
