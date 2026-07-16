
from __future__ import annotations

PRESETS: dict[str, dict] = {
    "radius": {
        "label": "RADIUS (auth + accounting)",
        "description": "Allow UDP 1812 (auth) and 1813 (accounting).",
        "rules": [
            {
                "chain": "input",
                "action": "accept",
                "protocol": "udp",
                "dport": "1812,1813",
                "comment": "RADIUS auth + accounting",
            },
        ],
    },
    "radius_coa": {
        "label": "RADIUS CoA / Disconnect",
        "description": "Allow UDP 3799 (Change-of-Authorization / Disconnect).",
        "rules": [
            {
                "chain": "input",
                "action": "accept",
                "protocol": "udp",
                "dport": "3799",
                "comment": "RADIUS CoA/Disconnect",
            },
        ],
    },
    "radsec": {
        "label": "RadSec (TLS)",
        "description": "Allow TCP 2083 (RADIUS over TLS).",
        "rules": [
            {
                "chain": "input",
                "action": "accept",
                "protocol": "tcp",
                "dport": "2083",
                "comment": "RadSec (RADIUS/TLS)",
            },
        ],
    },
    "ssh": {
        "label": "SSH",
        "description": "Allow TCP 22.",
        "rules": [
            {
                "chain": "input",
                "action": "accept",
                "protocol": "tcp",
                "dport": "22",
                "comment": "SSH",
            },
        ],
    },
    "web": {
        "label": "Web (HTTP/HTTPS)",
        "description": "Allow TCP 80 and 443.",
        "rules": [
            {
                "chain": "input",
                "action": "accept",
                "protocol": "tcp",
                "dport": "80,443",
                "comment": "HTTP/HTTPS",
            },
        ],
    },
}


def preset_rules(name: str, src_set: str | None = None) -> list[dict]:
    preset = PRESETS.get(name)
    if not preset:
        raise KeyError(name)
    rules = [dict(r) for r in preset["rules"]]
    if src_set:
        for r in rules:
            r["src_set"] = src_set
    return rules
