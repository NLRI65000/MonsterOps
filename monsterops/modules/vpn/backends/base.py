from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,14}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:_-]{0,253}$")
_USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$")
_WG_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")


class ConfigError(ValueError):
    pass


def safe_name(v: str) -> str:
    if not _IFACE_RE.match(v or ""):
        raise ConfigError(f"unsafe interface name: {v!r}")
    return v


def safe_host(v: str) -> str:
    if not _HOST_RE.match(v or ""):
        raise ConfigError(f"unsafe host: {v!r}")
    return v


def safe_user(v: str) -> str:
    if not _USER_RE.match(v or ""):
        raise ConfigError(f"unsafe username: {v!r}")
    return v


def safe_wg_key(v: str) -> str:
    if not _WG_KEY_RE.match(v or ""):
        raise ConfigError("unsafe WireGuard key")
    return v


def safe_secret(v: str) -> str:
    if any(c in v for c in '"\\\n\r') or any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
        raise ConfigError("secret contains forbidden characters")
    return v


def safe_port(v: int) -> int:
    if not isinstance(v, int) or not (1 <= v <= 65535):
        raise ConfigError(f"invalid port: {v!r}")
    return v


def safe_cidrs(csv: str | None) -> list[str]:
    out = []
    for raw in (csv or "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        out.append(str(ipaddress.ip_network(raw, strict=False)))
    return out


def safe_ip_interface(v: str) -> str:
    return str(ipaddress.ip_interface(v))


def safe_ips(csv: str | None) -> list[str]:
    return [str(ipaddress.ip_address(p.strip())) for p in (csv or "").split(",") if p.strip()]


@dataclass
class TunnelStatus:
    oper_state: str = "unknown"
    iface: str | None = None
    rx_bytes: int | None = None
    tx_bytes: int | None = None
    last_handshake_at: datetime | None = None
    detail: str | None = None


def _wrap_priv(argv: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return argv
    return ["sudo", "-n", *argv]


async def run(argv: list[str], *, input_text: str | None = None, timeout: float = 30.0,
              priv: bool = True) -> tuple[int, str, str]:
    cmd = _wrap_priv(argv) if priv else argv
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if input_text is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return 127, "", f"command not found: {cmd[0]}"
    try:
        out, err = await asyncio.wait_for(
            proc.communicate(input_text.encode() if input_text is not None else None),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "", f"timed out after {timeout}s: {' '.join(cmd)}"
    rc = proc.returncode if proc.returncode is not None else -1
    return rc, out.decode(errors="replace"), err.decode(errors="replace")


def have(binary: str) -> bool:
    return shutil.which(binary) is not None


class VpnBackend(ABC):

    type: str = ""

    @abstractmethod
    def preview(self, t) -> tuple[str, list[str]]:
        pass

    @abstractmethod
    async def up(self, t) -> TunnelStatus: ...

    @abstractmethod
    async def down(self, t) -> TunnelStatus: ...

    @abstractmethod
    async def status(self, t) -> TunnelStatus: ...

    @abstractmethod
    def tooling(self) -> tuple[bool, str | None]:
        pass
