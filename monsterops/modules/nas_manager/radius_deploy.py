
from __future__ import annotations

import socket
from dataclasses import dataclass, field

from monsterops.modules.nas_manager.vendor_map import resolve_vendor

SERVICE_LABELS: dict[str, str] = {
    "pppoe": "PPP / PPPoE broadband dial-in",
    "hotspot": "Hotspot / captive portal",
    "login": "Device admin login (router management)",
    "dot1x": "802.1X port authentication",
}

AVAILABLE_SERVICES: dict[str, list[str]] = {
    "mikrotik": ["pppoe", "hotspot", "login", "dot1x"],
    "huawei": ["pppoe", "login", "dot1x"],
}

VARIANTS: dict[str, list[dict]] = {
    "mikrotik": [
        {"key": "v7", "label": "RouterOS v7"},
        {"key": "v6", "label": "RouterOS v6"},
    ],
}


@dataclass
class DeployPlan:
    vendor: str
    pushable: bool
    lines: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    services: list[str] = field(default_factory=list)
    variant: str | None = None

    @property
    def config_text(self) -> str:
        return "\n".join(self.lines)


def available_services(vendor: str | None) -> list[dict]:
    resolved = resolve_vendor(vendor)
    keys = AVAILABLE_SERVICES.get(resolved or "", list(SERVICE_LABELS))
    return [{"key": k, "label": SERVICE_LABELS[k], "default": k == "pppoe"} for k in keys]


def variants_for(vendor: str | None) -> list[dict]:
    return VARIANTS.get(resolve_vendor(vendor) or "", [])


def _resolve_variant(resolved_vendor: str | None, variant: str | None) -> str | None:
    vs = VARIANTS.get(resolved_vendor or "", [])
    if not vs:
        return None
    keys = [v["key"] for v in vs]
    return variant if variant in keys else keys[0]


def detect_server_ip(target_host: str) -> str:
    if not target_host:
        return ""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((target_host, 1812))
            return str(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        return ""




def _mikrotik_common(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
) -> tuple[list[str], list[str]]:
    svc_map = {"pppoe": "ppp", "hotspot": "hotspot", "login": "login", "dot1x": "dot1x"}
    ros_services = [svc_map[s] for s in services if s in svc_map] or ["ppp"]
    svc = ",".join(dict.fromkeys(ros_services))
    lines = [
        f"/radius add address={server_ip} secret={secret} service={svc} "
        f"authentication-port={auth_port} accounting-port={acct_port} "
        f"timeout={int(timeout_s * 1000)}ms",
        "/radius incoming set accept=yes port=3799",
    ]
    notes: list[str] = []
    if "pppoe" in services:
        lines.append("/ppp aaa set use-radius=yes accounting=yes")
    if "login" in services:
        lines.append("/user aaa set use-radius=yes")
        notes.append(
            "Router-login via RADIUS is now on — keep a local admin account as a "
            "fallback so you are not locked out if RADIUS becomes unreachable."
        )
    if "hotspot" in services:
        notes.append(
            "Hotspot auth is set per profile — run "
            "`/ip hotspot profile set [profile] use-radius=yes` on each portal."
        )
    return lines, notes


def _mikrotik_v7(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
) -> tuple[list[str], list[str]]:
    lines, notes = _mikrotik_common(server_ip, secret, auth_port, acct_port, services, timeout_s)
    if "dot1x" in services:
        notes.append(
            "802.1X (RouterOS v7): configure `/interface dot1x server` on the access "
            "ports — v7 split dot1x into separate server and client sub-menus."
        )
    return lines, notes


def _mikrotik_v6(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
) -> tuple[list[str], list[str]]:
    lines, notes = _mikrotik_common(server_ip, secret, auth_port, acct_port, services, timeout_s)
    if "dot1x" in services:
        notes.append("802.1X (RouterOS v6): enable it per interface under `/interface dot1x`.")
    return lines, notes


def _mikrotik(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
    variant: str | None,
) -> tuple[list[str], list[str]]:
    if variant == "v6":
        return _mikrotik_v6(server_ip, secret, auth_port, acct_port, services, timeout_s)
    return _mikrotik_v7(server_ip, secret, auth_port, acct_port, services, timeout_s)


def _huawei(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
    variant: str | None = None,
) -> tuple[list[str], list[str]]:
    tmpl = "monsterops"
    lines = [
        f"radius-server template {tmpl}",
        f" radius-server authentication {server_ip} {auth_port} weight 80",
        f" radius-server accounting {server_ip} {acct_port} weight 80",
        f" radius-server shared-key cipher {secret}",
        " quit",
        "aaa",
        " authentication-scheme monsterops_auth",
        "  authentication-mode radius",
        "  quit",
        " accounting-scheme monsterops_acct",
        "  accounting-mode radius",
        "  quit",
        " domain monsterops",
        "  authentication-scheme monsterops_auth",
        "  accounting-scheme monsterops_acct",
        f"  radius-server {tmpl}",
        "  quit",
        " quit",
    ]
    notes: list[str] = []
    if "pppoe" in services:
        notes.append(
            "Bind your BAS/PPPoE access interface to the `monsterops` domain so "
            "broadband users authenticate against RADIUS."
        )
    if "login" in services:
        notes.append(
            "Device admin login: apply `authentication-scheme monsterops_auth` to "
            "the console/VTY user-interface."
        )
    if "dot1x" in services:
        notes.append(
            "802.1X: run `dot1x enable` globally and on the access interfaces, then "
            "bind them to the `monsterops` domain."
        )
    return lines, notes


def _generic(
    server_ip: str,
    secret: str,
    auth_port: int,
    acct_port: int,
    services: list[str],
    timeout_s: int,
    variant: str | None = None,
) -> tuple[list[str], list[str]]:
    notes = [
        "This vendor has no built-in RADIUS-client template, so these settings "
        "cannot be pushed automatically — enter them into the device's RADIUS "
        "configuration by hand.",
        f"RADIUS server        {server_ip}",
        f"Shared secret        {secret}",
        f"Authentication port  {auth_port}",
        f"Accounting port      {acct_port}",
        f"Services to enable    {', '.join(services) or '(none selected)'}",
    ]
    return [], notes


_BUILDERS = {"mikrotik": _mikrotik, "huawei": _huawei}


def build_plan(
    vendor: str | None,
    server_ip: str,
    secret: str,
    auth_port: int = 1812,
    acct_port: int = 1813,
    services: list[str] | None = None,
    timeout_s: int = 3,
    variant: str | None = None,
) -> DeployPlan:
    resolved = resolve_vendor(vendor)
    supported = AVAILABLE_SERVICES.get(resolved or "", list(SERVICE_LABELS))
    selected = [s for s in (services or []) if s in supported]
    variant = _resolve_variant(resolved, variant)

    builder = _BUILDERS.get(resolved or "")
    if builder is None:
        lines, notes = _generic(
            server_ip, secret, auth_port, acct_port, selected, timeout_s, variant
        )
        pushable = False
    else:
        lines, notes = builder(
            server_ip, secret, auth_port, acct_port, selected, timeout_s, variant
        )
        pushable = True

    return DeployPlan(
        vendor=resolved or (vendor or "generic"),
        pushable=pushable,
        lines=lines,
        notes=notes,
        services=selected,
        variant=variant,
    )
