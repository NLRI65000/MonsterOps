
from __future__ import annotations

VENDOR_MAP: dict[str, dict] = {
    "cisco": {
        "device_types": ["cisco_ios", "cisco_ios_xe", "cisco_nxos"],
        "config_cmd": "show running-config",
    },
    "huawei": {
        "device_types": ["huawei_vrp", "huawei_vrp_v8"],
        "config_cmd": "display current-configuration",
    },
    "mikrotik": {
        "device_types": ["mikrotik_routeros"],
        "config_cmd": "/export verbose",
    },
    "juniper": {
        "device_types": ["juniper_junos"],
        "config_cmd": "show configuration",
    },
    "ubiquiti": {
        "device_types": ["ubiquiti_edgerouter", "ubiquiti_edgeswitch"],
        "config_cmd": "show configuration",
    },
    "hp": {
        "device_types": ["hp_procurve", "hp_comware"],
        "config_cmd": "show running-config",
    },
    "ericsson": {
        "device_types": ["ericsson_ipos"],
        "config_cmd": "show configuration",
    },
}

SUPPORTED_VENDORS: frozenset[str] = frozenset(VENDOR_MAP.keys())


def resolve_vendor(nas_type: str | None) -> str | None:
    if not nas_type:
        return None
    t = nas_type.strip().lower()
    if t in VENDOR_MAP:
        return t
    for vendor in VENDOR_MAP:
        if vendor in t:
            return vendor
    return None


def device_types_for(vendor: str) -> list[str]:
    resolved = resolve_vendor(vendor)
    if resolved is None:
        return []
    return VENDOR_MAP[resolved]["device_types"]


def config_cmd_for(device_type: str) -> str:
    for meta in VENDOR_MAP.values():
        if (
            device_type in meta["device_types"]
            or device_type.replace("_telnet", "") in meta["device_types"]
        ):
            return meta["config_cmd"]
    return "show running-config"


def apply_conn_type(device_type: str, conn_type: str) -> str:
    base = device_type.replace("_telnet", "")
    if conn_type == "telnet":
        return base + "_telnet"
    return base
