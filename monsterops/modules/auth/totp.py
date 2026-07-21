
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

DIGITS = 6
PERIOD = 30
ISSUER = "MonsterOps"

_SECRET_BYTES = 20

_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_RECOVERY_GROUPS = 2
_RECOVERY_GROUP_LEN = 5


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(_SECRET_BYTES)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    s += "=" * (-len(s) % 8)
    return base64.b32decode(s, casefold=True)


def hotp(secret: str, counter: int, digits: int = DIGITS) -> str:
    key = _decode_secret(secret)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def totp(
    secret: str,
    *,
    for_time: float | None = None,
    period: int = PERIOD,
    digits: int = DIGITS,
) -> str:
    now = time.time() if for_time is None else for_time
    return hotp(secret, int(now // period), digits)


def verify(
    secret: str,
    code: str,
    *,
    for_time: float | None = None,
    period: int = PERIOD,
    digits: int = DIGITS,
    window: int = 1,
) -> bool:
    code = (code or "").strip()
    if len(code) != digits or not code.isdigit():
        return False
    now = time.time() if for_time is None else for_time
    step = int(now // period)
    for drift in range(-window, window + 1):
        candidate = hotp(secret, step + drift, digits)
        if hmac.compare_digest(candidate, code):
            return True
    return False


def provisioning_uri(username: str, secret: str, *, issuer: str = ISSUER) -> str:
    label = f"{quote(issuer)}:{quote(username)}"
    params = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": DIGITS,
            "period": PERIOD,
        }
    )
    return f"otpauth://totp/{label}?{params}"


def generate_recovery_codes(n: int = 10) -> list[str]:
    return [
        "-".join(
            "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP_LEN))
            for _ in range(_RECOVERY_GROUPS)
        )
        for _ in range(n)
    ]
