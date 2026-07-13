from __future__ import annotations

import base64
import ipaddress
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,14}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:_-]{0,253}$")
_USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$")
_WG_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")

TunnelType = Literal["wireguard", "l2tp-ipsec"]


def _check(pattern: re.Pattern[str], v: str, what: str) -> str:
    if not pattern.match(v):
        raise ValueError(f"invalid {what}")
    return v


def _no_special(v: str, what: str) -> str:
    if any(c in v for c in '"\\\n\r') or any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
        raise ValueError(f"{what} must not contain quotes, backslashes or control characters")
    return v


def _valid_wg_key(v: str, what: str) -> str:
    if not _WG_KEY_RE.match(v):
        raise ValueError(f"{what} must be a base64-encoded 32-byte WireGuard key")
    try:
        if len(base64.b64decode(v, validate=True)) != 32:
            raise ValueError
    except Exception:
        raise ValueError(f"{what} must be a base64-encoded 32-byte WireGuard key")
    return v


def _norm_cidrs(values: list[str]) -> str:
    out: list[str] = []
    for raw in values:
        raw = raw.strip()
        if not raw:
            continue
        try:
            net = ipaddress.ip_network(raw, strict=False)
        except ValueError:
            raise ValueError(f"invalid CIDR / network: {raw!r}")
        out.append(str(net))
    return ",".join(out)


def _valid_ip_interface(v: str, what: str) -> str:
    try:
        return str(ipaddress.ip_interface(v))
    except ValueError:
        raise ValueError(f"{what} must be an address with prefix, e.g. 10.99.0.2/32")


def _valid_ips(values: list[str], what: str) -> str:
    out: list[str] = []
    for raw in values:
        raw = raw.strip()
        if not raw:
            continue
        try:
            out.append(str(ipaddress.ip_address(raw)))
        except ValueError:
            raise ValueError(f"invalid {what}: {raw!r}")
    return ",".join(out)



class TunnelBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=15)
    type: TunnelType = "wireguard"
    enabled: bool = False
    description: str | None = Field(None, max_length=120)
    routes: list[str] = []

    wg_private_key: str | None = None
    wg_address: str | None = None
    wg_listen_port: int | None = Field(None, ge=1, le=65535)
    wg_peer_public_key: str | None = None
    wg_peer_host: str | None = None
    wg_peer_port: int | None = Field(51820, ge=1, le=65535)
    wg_persistent_keepalive: int | None = Field(None, ge=0, le=65535)
    wg_mtu: int | None = Field(None, ge=1280, le=9000)
    wg_dns: list[str] = []

    l2tp_gateway: str | None = None
    l2tp_psk: str | None = Field(None, max_length=128)
    l2tp_username: str | None = None
    l2tp_password: str | None = Field(None, max_length=128)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        return _check(_IFACE_RE, v, "tunnel name (letters, digits, _ - ; max 15 chars)")

    @field_validator("description")
    @classmethod
    def _v_desc(cls, v: str | None) -> str | None:
        return None if not v else _no_special(v, "description")

    @field_validator("routes")
    @classmethod
    def _v_routes(cls, v: list[str]) -> list[str]:
        _norm_cidrs(v)
        return v

    @field_validator("wg_private_key")
    @classmethod
    def _v_privkey(cls, v: str | None) -> str | None:
        return None if not v else _valid_wg_key(v, "WireGuard private key")

    @field_validator("wg_peer_public_key")
    @classmethod
    def _v_peerkey(cls, v: str | None) -> str | None:
        return None if not v else _valid_wg_key(v, "peer public key")

    @field_validator("wg_address")
    @classmethod
    def _v_addr(cls, v: str | None) -> str | None:
        return None if not v else _valid_ip_interface(v, "tunnel address")

    @field_validator("wg_peer_host", "l2tp_gateway")
    @classmethod
    def _v_host(cls, v: str | None) -> str | None:
        return None if not v else _check(_HOST_RE, v, "host / gateway")

    @field_validator("wg_dns")
    @classmethod
    def _v_dns(cls, v: list[str]) -> list[str]:
        _valid_ips(v, "DNS server")
        return v

    @field_validator("l2tp_psk", "l2tp_password")
    @classmethod
    def _v_secret(cls, v: str | None) -> str | None:
        return None if not v else _no_special(v, "secret")

    @field_validator("l2tp_username")
    @classmethod
    def _v_user(cls, v: str | None) -> str | None:
        return None if not v else _check(_USER_RE, v, "username")

    @model_validator(mode="after")
    def _require_per_type(self) -> "TunnelBase":
        if self.type == "wireguard":
            missing = [f for f in ("wg_address", "wg_peer_public_key", "wg_peer_host")
                       if not getattr(self, f)]
            if missing:
                raise ValueError(f"WireGuard tunnel requires: {', '.join(missing)}")
        elif self.type == "l2tp-ipsec":
            missing = [f for f in ("l2tp_gateway", "l2tp_username") if not getattr(self, f)]
            if missing:
                raise ValueError(f"L2TP/IPsec tunnel requires: {', '.join(missing)}")
        return self

    def routes_csv(self) -> str:
        return _norm_cidrs(self.routes)

    def dns_csv(self) -> str:
        return _valid_ips(self.wg_dns, "DNS server")


class TunnelCreate(TunnelBase):
    @model_validator(mode="after")
    def _require_secrets_on_create(self) -> "TunnelCreate":
        if self.type == "l2tp-ipsec":
            missing = [f for f in ("l2tp_psk", "l2tp_password") if not getattr(self, f)]
            if missing:
                raise ValueError(f"L2TP/IPsec tunnel requires: {', '.join(missing)}")
        return self


class TunnelUpdate(TunnelBase):
    wg_private_key: str | None = None
    l2tp_psk: str | None = Field(None, max_length=128)
    l2tp_password: str | None = Field(None, max_length=128)



class TunnelOut(BaseModel):
    id: int
    name: str
    type: TunnelType
    enabled: bool
    description: str | None
    routes: list[str]

    wg_public_key: str | None
    wg_address: str | None
    wg_listen_port: int | None
    wg_peer_public_key: str | None
    wg_peer_host: str | None
    wg_peer_port: int | None
    wg_persistent_keepalive: int | None
    wg_mtu: int | None
    wg_dns: list[str]

    l2tp_gateway: str | None
    l2tp_username: str | None
    l2tp_has_secrets: bool

    oper_state: str
    iface: str | None
    rx_bytes: int | None
    tx_bytes: int | None
    last_handshake_at: datetime | None
    last_error: str | None
    last_status_at: datetime | None
    tooling_ok: bool = True
    tooling_hint: str | None = None
    created_at: datetime

    @staticmethod
    def _split(csv: str | None) -> list[str]:
        return [p for p in (csv or "").split(",") if p]

    @classmethod
    def from_model(cls, t) -> "TunnelOut":
        return cls(
            id=t.id, name=t.name, type=t.type, enabled=t.enabled,
            description=t.description, routes=cls._split(t.routes),
            wg_public_key=t.wg_public_key, wg_address=t.wg_address,
            wg_listen_port=t.wg_listen_port, wg_peer_public_key=t.wg_peer_public_key,
            wg_peer_host=t.wg_peer_host, wg_peer_port=t.wg_peer_port,
            wg_persistent_keepalive=t.wg_persistent_keepalive, wg_mtu=t.wg_mtu,
            wg_dns=cls._split(t.wg_dns),
            l2tp_gateway=t.l2tp_gateway, l2tp_username=t.l2tp_username,
            l2tp_has_secrets=bool(t.l2tp_psk and t.l2tp_password),
            oper_state=t.oper_state, iface=t.iface, rx_bytes=t.rx_bytes,
            tx_bytes=t.tx_bytes, last_handshake_at=t.last_handshake_at,
            last_error=t.last_error, last_status_at=t.last_status_at,
            created_at=t.created_at,
        )


class TunnelConfigPreview(BaseModel):
    content: str
    files: list[str]


class TunnelActionResult(BaseModel):
    tunnel: TunnelOut
    ok: bool
    detail: str | None = None
