
from __future__ import annotations

import ipaddress
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AuthMethod = Literal["local_password", "directory_delegated"]
RuleAction = Literal["permit", "deny"]

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@\\-]{0,63}$")


def _no_control(v: str, what: str) -> str:
    if any(ord(c) < 0x20 for c in v):
        raise ValueError(f"{what} must not contain control characters")
    return v




class TacacsClientBase(BaseModel):
    name: str = Field(..., max_length=64)
    address: str = Field(
        ..., max_length=64, description="IP address or CIDR the device connects from"
    )
    nas_id: int | None = None
    single_connect: bool = False
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("invalid name: only letters, digits and . _ - are allowed")
        return v

    @field_validator("address")
    @classmethod
    def _address(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError("address must be an IP address or CIDR network")
        return v


class TacacsClientCreate(TacacsClientBase):
    secret: str = Field(..., min_length=1, max_length=128)

    @field_validator("secret")
    @classmethod
    def _secret(cls, v: str) -> str:
        return _no_control(v, "secret")


class TacacsClientUpdate(TacacsClientBase):
    secret: str = Field("", max_length=128)

    @field_validator("secret")
    @classmethod
    def _secret(cls, v: str) -> str:
        return _no_control(v, "secret")


class TacacsClientOut(BaseModel):
    id: int
    name: str
    address: str
    nas_id: int | None
    single_connect: bool
    enabled: bool
    created_at: datetime
    model_config = {"from_attributes": True}




class TacacsUserBase(BaseModel):
    username: str = Field(..., max_length=64)
    auth_method: AuthMethod = "local_password"
    identity_source_id: int | None = None
    privilege_level: int = Field(1, ge=0, le=15)
    enabled: bool = True

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError("invalid username: letters, digits and . _ - @ \\ only")
        return v


class TacacsUserCreate(TacacsUserBase):
    password: str = Field("", max_length=128)

    @model_validator(mode="after")
    def _require_credential(self) -> TacacsUserCreate:
        if self.auth_method == "local_password" and not self.password:
            raise ValueError("password is required for a local_password account")
        if self.auth_method == "directory_delegated" and not self.identity_source_id:
            raise ValueError("identity_source_id is required for a directory_delegated account")
        return self


class TacacsUserUpdate(TacacsUserBase):
    password: str = Field("", max_length=128)

    @model_validator(mode="after")
    def _require_source(self) -> TacacsUserUpdate:
        if self.auth_method == "directory_delegated" and not self.identity_source_id:
            raise ValueError("identity_source_id is required for a directory_delegated account")
        return self


class TacacsUserOut(BaseModel):
    id: int
    username: str
    auth_method: AuthMethod
    identity_source_id: int | None
    privilege_level: int
    enabled: bool
    has_password: bool = False
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}




class TacacsRuleBase(BaseModel):
    sort_order: int = Field(0, ge=0)
    action: RuleAction = "permit"
    command: str = Field(..., max_length=255, description="regex matched against the command line")

    @field_validator("command")
    @classmethod
    def _command(cls, v: str) -> str:
        _no_control(v, "command pattern")
        try:
            re.compile(v)
        except re.error as exc:
            raise ValueError(f"invalid regular expression: {exc}")
        return v


class TacacsRuleCreate(TacacsRuleBase):
    pass


class TacacsRuleUpdate(TacacsRuleBase):
    pass


class TacacsRuleOut(BaseModel):
    id: int
    user_id: int
    sort_order: int
    action: RuleAction
    command: str
    created_at: datetime
    model_config = {"from_attributes": True}




class TacacsAcctRecordOut(BaseModel):
    id: int
    username: str
    client_id: int | None
    client_name: str | None
    record_type: str
    priv_lvl: int | None
    port: str | None
    rem_addr: str | None
    service: str | None
    cmd: str | None
    task_id: str | None
    elapsed_time: int | None
    args: str | None
    created_at: datetime
    model_config = {"from_attributes": True}




class TacacsStatus(BaseModel):
    enabled: bool
    host: str
    port: int


class IdentitySourceRef(BaseModel):

    id: int
    name: str
    host: str
    model_config = {"from_attributes": True}




class AaaVendor(BaseModel):
    id: str
    label: str


class AaaSnippet(BaseModel):
    vendor: str
    label: str
    server: str
    port: int
    text: str
