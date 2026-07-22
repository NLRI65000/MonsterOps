
from __future__ import annotations

VENDORS: dict[str, str] = {
    "cisco_ios": "Cisco IOS / IOS-XE",
    "arista": "Arista EOS",
    "juniper": "Juniper Junos",
    "huawei": "Huawei VRP",
    "generic": "Generic / other",
}

_KEY = "<shared-secret>"


def _cisco_ios(server: str, port: int) -> str:
    port_line = f"\n port {port}" if port != 49 else ""
    return (
        "aaa new-model\n"
        "tacacs server MONSTEROPS\n"
        f" address ipv4 {server}\n"
        f" key {_KEY}{port_line}\n"
        "aaa group server tacacs+ MONSTEROPS\n"
        " server name MONSTEROPS\n"
        "aaa authentication login default group MONSTEROPS local\n"
        "aaa authorization exec default group MONSTEROPS local\n"
        "aaa authorization commands 15 default group MONSTEROPS local\n"
        "aaa accounting commands 15 default start-stop group MONSTEROPS"
    )


def _arista(server: str, port: int) -> str:
    port_opt = f" port {port}" if port != 49 else ""
    return (
        f"tacacs-server host {server}{port_opt} key 0 {_KEY}\n"
        "aaa group server tacacs+ MONSTEROPS\n"
        f" server {server}\n"
        "aaa authentication login default group MONSTEROPS local\n"
        "aaa authorization exec default group MONSTEROPS local\n"
        "aaa authorization commands all default group MONSTEROPS local\n"
        "aaa accounting commands all default start-stop group MONSTEROPS"
    )


def _juniper(server: str, port: int) -> str:
    port_line = f'set system tacplus-server {server} port {port}\n' if port != 49 else ""
    return (
        f'set system tacplus-server {server} secret "{_KEY}"\n'
        f"{port_line}"
        "set system authentication-order [ tacplus password ]\n"
        "set system accounting events [ login interactive-commands ]\n"
        f'set system accounting destination tacplus server {server} secret "{_KEY}"'
    )


def _huawei(server: str, port: int) -> str:
    ports = f" {port}" if port != 49 else ""
    return (
        "hwtacacs-server template MONSTEROPS\n"
        f" hwtacacs-server authentication {server}{ports}\n"
        f" hwtacacs-server authorization {server}{ports}\n"
        f" hwtacacs-server accounting {server}{ports}\n"
        f" hwtacacs-server shared-key cipher {_KEY}\n"
        "#\n"
        "aaa\n"
        " authentication-scheme tacacs\n"
        "  authentication-mode hwtacacs\n"
        " authorization-scheme tacacs\n"
        "  authorization-mode hwtacacs local\n"
        " accounting-scheme tacacs\n"
        "  accounting-mode hwtacacs\n"
        " domain default\n"
        "  authentication-scheme tacacs\n"
        "  authorization-scheme tacacs\n"
        "  accounting-scheme tacacs\n"
        "  hwtacacs-server template MONSTEROPS"
    )


def _generic(server: str, port: int) -> str:
    return (
        "# Point the device's TACACS+ (AAA) client at MonsterOps:\n"
        f"#   server : {server}\n"
        f"#   port   : {port}/tcp\n"
        "#   secret : <shared-secret>  (the shared secret set on this client)\n"
        "#\n"
        "# Then enable, in the device's AAA/admin configuration:\n"
        "#   - authentication : admin login via TACACS+, falling back to local\n"
        "#   - authorization  : per-command authorization via TACACS+\n"
        "#   - accounting     : login + command accounting via TACACS+"
    )


_BUILDERS = {
    "cisco_ios": _cisco_ios,
    "arista": _arista,
    "juniper": _juniper,
    "huawei": _huawei,
    "generic": _generic,
}


def build_aaa_snippet(vendor: str, server: str, port: int = 49) -> str:
    return _BUILDERS.get(vendor, _generic)(server, port)
