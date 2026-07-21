from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AdminUserOut(BaseModel):
    id: int
    username: str
    email: str | None
    role: str
    is_active: bool
    totp_required: bool = False
    totp_enabled: bool = False
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
    totp_required: bool | None = None


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


class LoginResponse(BaseModel):

    mfa_required: bool = False
    mfa_setup_required: bool = False
    role: str | None = None
    username: str | None = None
    pending_token: str | None = None


class StatusResponse(BaseModel):
    first_run: bool
    console_enabled: bool = False




class TotpSetupResponse(BaseModel):

    secret: str
    otpauth_uri: str


class TotpEnableRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class TotpDisableRequest(BaseModel):

    password: str | None = None
    code: str | None = None


class TotpStatusResponse(BaseModel):
    enabled: bool
    required: bool


class TotpEnableResponse(BaseModel):

    enabled: bool
    recovery_codes: list[str]


class RecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class TotpVerifyRequest(BaseModel):

    pending_token: str
    code: str


class AuditLogOut(BaseModel):
    id: int
    admin_username: str
    action: str
    target: str | None
    detail: dict | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
