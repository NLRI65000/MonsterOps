"""
Generate the `table inet monsterops` ruleset from DB rows.

Only ever emits our own table; operator tables are never referenced. Every value
is re-validated here (defence in depth) before being written into the text, and
the result is applied atomically with `nft -f` (add/delete/recreate idiom).
"""
from __future__ import annotations

import ipaddress
import math
from datetime import datetime, timezone

from monsterops.modules.firewall import validators as V
from monsterops.modules.firewall.models import MrFirewallConfig, MrFirewallRule, MrFirewallSet

TABLE_NAME = "monsterops"


def _fam_prefix(addr: str) -> str:
    return "ip6" if ipaddress.ip_network(addr, strict=False).version == 6 else "ip"


def _port_expr(spec: str) -> str:
    V.validate_ports(spec)
    parts = [p.strip() for p in spec.split(",")]
    if len(parts) > 1:
        return "{ " + ", ".join(parts) + " }"
    return parts[0]


def _render_rule(r: MrFirewallRule, set_family: dict[str, str]) -> str:
    frags: list[str] = []

    if r.iifname:
        frags.append(f'iifname "{V.validate_iface(r.iifname)}"')
    if r.oifname:
        frags.append(f'oifname "{V.validate_iface(r.oifname)}"')

    proto = r.protocol or "any"
    V.validate_choice(proto, V.PROTOCOLS, "protocol")
    has_port = bool((r.sport or r.dport) and proto in ("tcp", "udp"))
    if proto in ("tcp", "udp"):
        if not has_port:
            frags.append(f"meta l4proto {proto}")
    elif proto == "icmp":
        frags.append("ip protocol icmp")
    elif proto == "icmpv6":
        frags.append("ip6 nexthdr ipv6-icmp")

    if r.src_set:
        name = V.validate_name(r.src_set)
        fam = "ip6" if set_family.get(name) == "ipv6_addr" else "ip"
        frags.append(f"{fam} saddr @{name}")
    elif r.saddr:
        V.validate_addr(r.saddr)
        frags.append(f"{_fam_prefix(r.saddr)} saddr {r.saddr}")

    if r.daddr:
        V.validate_addr(r.daddr)
        frags.append(f"{_fam_prefix(r.daddr)} daddr {r.daddr}")

    if r.sport and proto in ("tcp", "udp"):
        frags.append(f"{proto} sport {_port_expr(r.sport)}")
    if r.dport and proto in ("tcp", "udp"):
        frags.append(f"{proto} dport {_port_expr(r.dport)}")

    if r.ct_state:
        frags.append(f"ct state {V.validate_ct_state(r.ct_state)}")

    action = V.validate_choice(r.action, V.ACTIONS, "action")
    frags.append("counter")
    frags.append(action)

    line = " ".join(frags)
    if r.comment:
        safe = str(r.comment).replace('"', "'")[:120]
        line += f' comment "{safe}"'
    return line


def _render_set(s: MrFirewallSet, now: datetime) -> str:
    V.validate_name(s.name)
    fam = V.validate_choice(s.family, V.FAMILIES, "family")

    rendered: list[str] = []
    has_timed = False
    for e in s.entries:
        addr = V.validate_addr(e.element)
        exp = getattr(e, "expires_at", None)
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            remaining = math.ceil((exp - now).total_seconds())
            if remaining <= 0:
                continue
            rendered.append(f"{addr} timeout {remaining}s")
            has_timed = True
        else:
            rendered.append(addr)

    flags = "interval, timeout" if (has_timed or getattr(s, "auto_ban", False)) else "interval"
    lines = [f"    set {s.name} {{", f"        type {fam}", f"        flags {flags}"]
    if rendered:
        lines.append("        elements = { " + ", ".join(rendered) + " }")
    lines.append("    }")
    return "\n".join(lines)


def _guard_lines(cfg: MrFirewallConfig, guard_ips: list[str]) -> list[str]:
    """Anti-lockout rules always emitted first when the input policy is drop."""
    out = [
        'iif "lo" accept',
        "ct state established,related accept",
        "ct state invalid drop",
    ]
    if cfg.allow_ping:
        out.append("ip protocol icmp accept")
        out.append("ip6 nexthdr ipv6-icmp accept")
    out.append(f"tcp dport {int(cfg.ssh_guard_port)} counter accept comment \"guard: ssh\"")
    out.append(f"tcp dport {int(cfg.web_guard_port)} counter accept comment \"guard: monsterops ui\"")
    for ip in guard_ips:
        V.validate_addr(ip)
        out.append(f"{_fam_prefix(ip)} saddr {ip} counter accept comment \"guard: admin session\"")
    return out


def generate_ruleset(
    cfg: MrFirewallConfig,
    rules: list[MrFirewallRule],
    sets: list[MrFirewallSet],
    guard_ips: list[str] | None = None,
    now: datetime | None = None,
) -> str:
    guard_ips = guard_ips or []
    now = now or datetime.now(timezone.utc)
    in_policy = V.validate_choice(cfg.default_input_policy, V.POLICIES, "default_input_policy")
    fwd_policy = V.validate_choice(cfg.default_forward_policy, V.POLICIES, "default_forward_policy")
    set_family = {s.name: s.family for s in sets}

    body: list[str] = []

    for s in sets:
        body.append(_render_set(s, now))

    body.append("    chain input {")
    body.append(f"        type filter hook input priority 0; policy {in_policy};")
    if in_policy == "drop":
        for line in _guard_lines(cfg, guard_ips):
            body.append("        " + line)
    for s in sets:
        if s.kind == "block":
            fam = "ip6" if s.family == "ipv6_addr" else "ip"
            body.append(f"        {fam} saddr @{s.name} counter drop comment \"blocklist: {s.name}\"")
        elif s.kind == "allow":
            fam = "ip6" if s.family == "ipv6_addr" else "ip"
            body.append(f"        {fam} saddr @{s.name} counter accept comment \"allowlist: {s.name}\"")
    for r in rules:
        if r.enabled and r.chain == "input":
            body.append("        " + _render_rule(r, set_family))
    body.append("    }")

    body.append("    chain forward {")
    body.append(f"        type filter hook forward priority 0; policy {fwd_policy};")
    if fwd_policy == "drop":
        body.append("        ct state established,related accept")
    for r in rules:
        if r.enabled and r.chain == "forward":
            body.append("        " + _render_rule(r, set_family))
    body.append("    }")

    body.append("    chain output {")
    body.append("        type filter hook output priority 0; policy accept;")
    for r in rules:
        if r.enabled and r.chain == "output":
            body.append("        " + _render_rule(r, set_family))
    body.append("    }")

    inner = "\n".join(body)
    return (
        f"add table inet {TABLE_NAME}\n"
        f"delete table inet {TABLE_NAME}\n"
        f"table inet {TABLE_NAME} {{\n{inner}\n}}\n"
    )
