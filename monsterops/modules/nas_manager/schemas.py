from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator
from monsterops.modules.nas_manager.models import MrNasManager


_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$")
_USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$")
_DT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class NasManagerCreate(BaseModel):
    conn_type: str = "ssh"
    netmiko_device_type: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: str
    password: Optional[str] = None
    enabled: bool = True

    @field_validator("conn_type")
    @classmethod
    def _conn_type(cls, v: str) -> str:
        if v not in ("ssh", "telnet"):
            raise ValueError("conn_type must be ssh or telnet")
        return v

    @field_validator("netmiko_device_type")
    @classmethod
    def _device_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _DT_RE.match(v):
            raise ValueError("invalid netmiko_device_type")
        return v

    @field_validator("host")
    @classmethod
    def _host(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _HOST_RE.match(v):
            raise ValueError("invalid host")
        return v

    @field_validator("port")
    @classmethod
    def _port(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return v
        if not (1 <= v <= 65535):
            raise ValueError("port out of range")
        return v

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not _USER_RE.match(v):
            raise ValueError("invalid username")
        return v


class NasManagerOut(BaseModel):
    id: int
    nas_id: int
    enabled: bool
    conn_type: str
    netmiko_device_type: str
    host: str
    port: int
    username: str
    has_password: bool
    last_tested_at: Optional[datetime]
    test_status: Optional[str]
    test_error: Optional[str]
    has_config: bool
    config_pulled_at: Optional[datetime]
    config_pushed_at: Optional[datetime]

    history_enabled: bool = False
    fetch_interval_hours: int = 24
    retention_days: Optional[int] = None
    last_fetch_at: Optional[datetime] = None

    nas_name: Optional[str] = None
    nas_ip: Optional[str] = None
    nas_vendor: Optional[str] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_model(cls, m: MrNasManager) -> "NasManagerOut":
        return cls(
            id=m.id,
            nas_id=m.nas_id,
            enabled=m.enabled,
            conn_type=m.conn_type,
            netmiko_device_type=m.netmiko_device_type,
            host=m.host,
            port=m.port,
            username=m.username,
            has_password=bool(m.secret_enc),
            last_tested_at=m.last_tested_at,
            test_status=m.test_status or "untested",
            test_error=m.test_error,
            has_config=bool(m.raw_config),
            config_pulled_at=m.config_pulled_at,
            config_pushed_at=m.config_pushed_at,
            history_enabled=bool(m.history_enabled),
            fetch_interval_hours=m.fetch_interval_hours if m.fetch_interval_hours is not None else 24,
            retention_days=m.retention_days,
            last_fetch_at=m.last_fetch_at,
            nas_name=m.nas.shortname if m.nas else None,
            nas_ip=m.nas.nasname if m.nas else None,
            nas_vendor=m.nas.type if m.nas else None,
        )


class HistorySettingsIn(BaseModel):
    history_enabled: bool = False
    fetch_interval_hours: int = 24
    retention_days: Optional[int] = None

    @field_validator("fetch_interval_hours")
    @classmethod
    def _interval(cls, v: int) -> int:
        if v < 0 or v > 8760:
            raise ValueError("fetch_interval_hours must be between 0 and 8760")
        return v

    @field_validator("retention_days")
    @classmethod
    def _retention(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 0 or v > 3650):
            raise ValueError("retention_days must be between 0 and 3650")
        return v


class ConfigVersionOut(BaseModel):
    id: int
    created_at: datetime
    source: str
    byte_size: int
    line_count: int
    sha256_short: str
    added: int = 0
    removed: int = 0


class VendorTypesOut(BaseModel):
    vendor: str
    device_types: list[str]
    supported: bool


class DispatchRequest(BaseModel):
    nas_ids: list[int]
    command: str

    @field_validator("nas_ids")
    @classmethod
    def _ids(cls, v: list[int]) -> list[int]:
        if not v or len(v) > 50:
            raise ValueError("nas_ids must have 1–50 entries")
        return v

    @field_validator("command")
    @classmethod
    def _cmd(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 500:
            raise ValueError("command must be 1–500 chars")
        return v
