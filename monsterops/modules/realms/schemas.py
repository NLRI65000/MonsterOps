from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_REALM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:-]{0,253}$")
_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")

ServerType = Literal["auth", "acct", "both"]
PoolType = Literal["fail-over", "load-balance", "client-balance", "client-port-balance"]


def _check(pattern: re.Pattern[str], v: str, what: str) -> str:
    if not pattern.match(v):
        raise ValueError(f"invalid {what}: only letters, digits and . _ - are allowed")
    return v



class HomeServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    host: str = Field(..., min_length=1, max_length=254)
    auth_port: int = Field(1812, ge=1, le=65535)
    acct_port: int = Field(1813, ge=1, le=65535)
    secret: str = Field(..., min_length=1, max_length=128)
    type: ServerType = "auth"
    response_window: int = Field(20, ge=1, le=300)
    zombie_period: int = Field(40, ge=1, le=600)
    revive_interval: int = Field(120, ge=10, le=3600)
    vpn_interface: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "server name")

    @field_validator("host")
    @classmethod
    def _host(cls, v: str) -> str:
        return _check(_HOST_RE, v, "host")

    @field_validator("secret")
    @classmethod
    def _secret(cls, v: str) -> str:
        if any(c in v for c in '"\\\n\r') or any(ord(c) < 0x20 for c in v):
            raise ValueError('secret must not contain quotes, backslashes or control characters')
        return v

    @field_validator("vpn_interface")
    @classmethod
    def _iface(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return _check(_IFACE_RE, v, "VPN interface name")


class HomeServerUpdate(HomeServerCreate):
    secret: str = Field("", max_length=128)


class HomeServerOut(BaseModel):
    id: int
    name: str
    host: str
    auth_port: int
    acct_port: int
    type: ServerType
    response_window: int
    zombie_period: int
    revive_interval: int
    vpn_interface: str | None
    status: str
    last_rtt_ms: float | None
    last_seen_at: datetime | None
    last_probe_at: datetime | None
    vpn_interface_up: bool | None = None
    created_at: datetime
    model_config = {"from_attributes": True}



class PoolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    pool_type: PoolType = "fail-over"
    server_ids: list[int] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "pool name")


class PoolOut(BaseModel):
    id: int
    name: str
    pool_type: PoolType
    server_ids: list[int]
    server_names: list[str]
    status: str
    created_at: datetime



class RealmCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    pool_id: int | None = None
    strip_username: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_REALM_RE, v, "realm name")


class RealmOut(BaseModel):
    id: int
    name: str
    pool_id: int | None
    pool_name: str | None
    strip_username: bool
    status: str
    last_rtt_ms: float | None
    last_probe_at: datetime | None
    created_at: datetime



class NasGroupRealmCreate(BaseModel):
    nas_group_id: int
    realm_id: int


class NasGroupRealmOut(BaseModel):
    id: int
    nas_group_id: int
    nas_group_name: str
    realm_id: int
    realm_name: str



class ProxyConfPreview(BaseModel):
    content: str
    path: str


class ProxyConfApplyResult(BaseModel):
    written: bool
    path: str
    bytes: int
    restart_triggered: bool
