
from __future__ import annotations

STANDARD = [
    {
        "attribute": "Session-Timeout",
        "op": ":=",
        "example": "3600",
        "description": "Max session duration (seconds)",
    },
    {
        "attribute": "Idle-Timeout",
        "op": ":=",
        "example": "300",
        "description": "Disconnect after N seconds idle",
    },
    {
        "attribute": "Framed-IP-Address",
        "op": ":=",
        "example": "192.168.1.100",
        "description": "Static IP address for this user",
    },
    {
        "attribute": "Framed-IP-Netmask",
        "op": ":=",
        "example": "255.255.255.0",
        "description": "Subnet mask for framed IP",
    },
    {
        "attribute": "Service-Type",
        "op": ":=",
        "example": "Framed-User",
        "description": "Type of service (Framed-User=2)",
    },
]

VENDOR: dict[str, list[dict[str, str]]] = {
    "mikrotik": [
        {
            "attribute": "Mikrotik-Rate-Limit",
            "op": ":=",
            "example": "10M/2M",
            "description": "Download/upload rate limit (e.g. 10M/2M or 10M/2M 20M/4M 8/8 1200/512)",
        },
        {
            "attribute": "Mikrotik-Mark",
            "op": ":=",
            "example": "customers",
            "description": "Packet mark applied in the firewall mangle chain",
        },
        {
            "attribute": "Mikrotik-Address-List",
            "op": ":=",
            "example": "allowed-hosts",
            "description": "Add client's IP to this address list",
        },
        {
            "attribute": "Mikrotik-Group",
            "op": ":=",
            "example": "full",
            "description": "Hotspot user profile / PPP profile to assign",
        },
        {
            "attribute": "Mikrotik-Realm",
            "op": ":=",
            "example": "hotspot1",
            "description": "Hotspot realm override",
        },
    ],
    "huawei": [
        {
            "attribute": "Huawei-Input-Average-Rate",
            "op": ":=",
            "example": "10240",
            "description": "Download average rate (kbps)",
        },
        {
            "attribute": "Huawei-Output-Average-Rate",
            "op": ":=",
            "example": "2048",
            "description": "Upload average rate (kbps)",
        },
        {
            "attribute": "Huawei-Input-Peak-Rate",
            "op": ":=",
            "example": "20480",
            "description": "Download peak (burst) rate (kbps)",
        },
        {
            "attribute": "Huawei-Output-Peak-Rate",
            "op": ":=",
            "example": "4096",
            "description": "Upload peak (burst) rate (kbps)",
        },
        {
            "attribute": "Huawei-Input-Burst-Size",
            "op": ":=",
            "example": "187500",
            "description": "Download burst bucket size (bytes)",
        },
        {
            "attribute": "Huawei-Output-Burst-Size",
            "op": ":=",
            "example": "37500",
            "description": "Upload burst bucket size (bytes)",
        },
        {
            "attribute": "Huawei-Priority",
            "op": ":=",
            "example": "0",
            "description": "QoS priority (0=highest)",
        },
    ],
    "cisco": [
        {
            "attribute": "Cisco-AVPair",
            "op": ":=",
            "example": "ip:addr-pool=dialin_pool",
            "description": "Generic AV-pair for Cisco IOS (ip:, lcp:, etc.)",
        },
        {
            "attribute": "Cisco-IP-Direct",
            "op": ":=",
            "example": "192.168.1.100",
            "description": "Direct IP assignment for Cisco dialup",
        },
    ],
    "ubiquiti": [
        {
            "attribute": "WISPr-Bandwidth-Max-Down",
            "op": ":=",
            "example": "10240000",
            "description": "Max download bandwidth (bps)",
        },
        {
            "attribute": "WISPr-Bandwidth-Max-Up",
            "op": ":=",
            "example": "2048000",
            "description": "Max upload bandwidth (bps)",
        },
    ],
}


def get_hints(nas_types: list[str]) -> dict:
    seen: set[str] = set()
    hints: list[dict[str, str]] = []

    matched_vendors: set[str] = set()
    for t in nas_types:
        t_lower = t.lower()
        for vendor_key in VENDOR:
            if vendor_key in t_lower:
                matched_vendors.add(vendor_key)

    for h in STANDARD:
        if h["attribute"] not in seen:
            seen.add(h["attribute"])
            hints.append({**h, "vendor": "standard"})

    for vendor in sorted(matched_vendors):
        for h in VENDOR[vendor]:
            if h["attribute"] not in seen:
                seen.add(h["attribute"])
                hints.append({**h, "vendor": vendor})

    return {"hints": hints, "vendors": sorted(matched_vendors)}
