from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AdminUserOut(BaseModel):
    id: int
    username: str
    email: str | None
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    email: str | None = None
    password: str = Field(..., min_length=8)
    role: str = Field(default="readonly", pattern="^(superadmin|admin|readonly)$")


class AdminUserUpdate(BaseModel):
    email: str | None = None
    password: str | None = Field(default=None, min_length=8)
    role: str | None = Field(default=None, pattern="^(superadmin|admin|readonly)$")
    is_active: bool | None = None


class SelfUpdate(BaseModel):

    email: str | None = None
    password: str | None = Field(default=None, min_length=8)


class SetupRequest(BaseModel):

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=8)
    email: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class SessionResponse(BaseModel):

    role: str
    username: str


class StatusResponse(BaseModel):
    first_run: bool


class AuditLogOut(BaseModel):
    id: int
    admin_username: str
    action: str
    target: str | None
    detail: dict | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
