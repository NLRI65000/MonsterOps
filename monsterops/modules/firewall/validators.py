
from __future__ import annotations

import ipaddress
import re

CHAINS = frozenset({"input", "forward", "output"})
ACTIONS = frozenset({"accept", "drop", "reject"})
PROTOCOLS = frozenset({"tcp", "udp", "icmp", "icmpv6", "any"})
FAMILIES = frozenset({"ipv4_addr", "ipv6_addr"})
SET_KINDS = frozenset({"block", "allow", "generic"})
POLICIES = frozenset({"drop", "accept"})
CT_STATES = frozenset({"new", "established", "related", "invalid", "untracked"})

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


class FirewallValidationError(ValueError):
    pass


def _fail(msg: str):
    raise FirewallValidationError(msg)


def validate_choice(value: str, allowed: frozenset[str], field: str) -> str:
    if value not in allowed:
        _fail(f"{field} must be one of {sorted(allowed)}, got {value!r}")
    return value


def validate_name(name: str) -> str:
    if not _NAME_RE.match(name or ""):
        _fail(f"invalid set name {name!r} (use lowercase letters, digits, underscore)")
    return name


def validate_iface(iface: str) -> str:
    if not _IFACE_RE.match(iface or ""):
        _fail(f"invalid interface name {iface!r}")
    return iface


def validate_addr(addr: str) -> str:
    try:
        ipaddress.ip_network(addr, strict=False)
    except ValueError:
        _fail(f"invalid address/CIDR {addr!r}")
    return addr


def validate_ports(spec: str) -> str:
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo_s, hi_s = part.split("-", 1)
            lo, hi = _port(lo_s), _port(hi_s)
            if lo > hi:
                _fail(f"port range {part!r} is reversed")
        else:
            _port(part)
    return spec


def _port(s: str) -> int:
    try:
        p = int(s)
    except ValueError:
        _fail(f"port {s!r} is not a number")
    if not (1 <= p <= 65535):
        _fail(f"port {p} out of range 1..65535")
    return p


def validate_ct_state(spec: str) -> str:
    for part in spec.split(","):
        validate_choice(part.strip(), CT_STATES, "ct_state")
    return spec
