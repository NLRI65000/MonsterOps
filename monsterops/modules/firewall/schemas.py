from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from monsterops.modules.firewall import validators as V


class RuleIn(BaseModel):
    enabled: bool = True
    chain: str = "input"
    action: str = "accept"
    protocol: Optional[str] = None
    saddr: Optional[str] = None
    daddr: Optional[str] = None
    sport: Optional[str] = None
    dport: Optional[str] = None
    iifname: Optional[str] = None
    oifname: Optional[str] = None
    ct_state: Optional[str] = None
    src_set: Optional[str] = None
    comment: Optional[str] = None

    @field_validator("chain")
    @classmethod
    def _chain(cls, v: str) -> str:
        return V.validate_choice(v, V.CHAINS, "chain")

    @field_validator("action")
    @classmethod
    def _action(cls, v: str) -> str:
        return V.validate_choice(v, V.ACTIONS, "action")

    @field_validator("protocol")
    @classmethod
    def _proto(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_choice(v, V.PROTOCOLS, "protocol")

    @field_validator("saddr", "daddr")
    @classmethod
    def _addr(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_addr(v)

    @field_validator("sport", "dport")
    @classmethod
    def _ports(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_ports(v)

    @field_validator("iifname", "oifname")
    @classmethod
    def _iface(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_iface(v)

    @field_validator("ct_state")
    @classmethod
    def _ct(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_ct_state(v)

    @field_validator("src_set")
    @classmethod
    def _srcset(cls, v: Optional[str]) -> Optional[str]:
        return None if v in (None, "") else V.validate_name(v)


class RuleOut(RuleIn):
    id: int
    position: int
    model_config = {"from_attributes": True}


class ReorderIn(BaseModel):
    order: list[int]


class ConfigIn(BaseModel):
    managed: bool = False
    default_input_policy: str = "drop"
    default_forward_policy: str = "drop"
    allow_ping: bool = True
    ssh_guard_port: int = 22
    web_guard_port: int = 8000
    confirm_timeout: int = 60
    autoblock_enabled: bool = False
    autoblock_threshold: int = 10
    autoblock_window: int = 10
    autoblock_ban_seconds: int = 3600

    @field_validator("default_input_policy", "default_forward_policy")
    @classmethod
    def _pol(cls, v: str) -> str:
        return V.validate_choice(v, V.POLICIES, "policy")

    @field_validator("ssh_guard_port", "web_guard_port")
    @classmethod
    def _port(cls, v: int) -> int:
        if not (1 <= v <= 65535):
            raise ValueError("port out of range")
        return v

    @field_validator("confirm_timeout")
    @classmethod
    def _timeout(cls, v: int) -> int:
        if not (10 <= v <= 600):
            raise ValueError("confirm_timeout must be 10..600 seconds")
        return v

    @field_validator("autoblock_threshold")
    @classmethod
    def _ab_threshold(cls, v: int) -> int:
        if not (2 <= v <= 10000):
            raise ValueError("autoblock_threshold must be 2..10000 rejects")
        return v

    @field_validator("autoblock_window")
    @classmethod
    def _ab_window(cls, v: int) -> int:
        if not (1 <= v <= 1440):
            raise ValueError("autoblock_window must be 1..1440 minutes")
        return v

    @field_validator("autoblock_ban_seconds")
    @classmethod
    def _ab_ban(cls, v: int) -> int:
        if v != 0 and not (60 <= v <= 604800):
            raise ValueError("autoblock_ban_seconds must be 0 (permanent) or 60..604800")
        return v


class ConfigOut(ConfigIn):
    last_applied_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class SetIn(BaseModel):
    name: str
    family: str = "ipv4_addr"
    kind: str = "block"
    auto_ban: bool = False
    comment: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return V.validate_name(v)

    @field_validator("family")
    @classmethod
    def _fam(cls, v: str) -> str:
        return V.validate_choice(v, V.FAMILIES, "family")

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        return V.validate_choice(v, V.SET_KINDS, "kind")


class SetEntryIn(BaseModel):
    element: str
    comment: Optional[str] = None
    ttl_seconds: Optional[int] = None

    @field_validator("element")
    @classmethod
    def _el(cls, v: str) -> str:
        return V.validate_addr(v)


class CountryBlockIn(BaseModel):
    country_code: str = Field(..., min_length=2, max_length=2)

    @field_validator("country_code")
    @classmethod
    def _cc(cls, v: str) -> str:
        s = (v or "").strip().upper()
        if len(s) != 2 or not s.isalpha():
            raise ValueError("country_code must be a 2-letter ISO code, e.g. CN")
        return s


class BlockEventOut(BaseModel):
    id: int
    element: str
    source: str
    reason: Optional[str] = None
    set_name: str
    ban_seconds: Optional[int] = None
    override_by: Optional[str] = None
    override_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}
