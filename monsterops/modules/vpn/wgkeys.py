
from __future__ import annotations

import base64
import os

_P = 2**255 - 19
_A24 = 121665


def _clamp(k: bytes) -> bytes:
    b = bytearray(k)
    b[0] &= 248
    b[31] &= 127
    b[31] |= 64
    return bytes(b)


def _x25519(scalar: bytes, u_bytes: bytes) -> bytes:
    k = int.from_bytes(_clamp(scalar), "little")
    u = bytearray(u_bytes)
    u[31] &= 127
    x1 = int.from_bytes(u, "little")

    x2, z2, x3, z3, swap = 1, 0, x1, 1, 0
    for t in range(254, -1, -1):
        kt = (k >> t) & 1
        swap ^= kt
        if swap:
            x2, x3 = x3, x2
            z2, z3 = z3, z2
        swap = kt

        a = (x2 + z2) % _P
        aa = a * a % _P
        b = (x2 - z2) % _P
        bb = b * b % _P
        e = (aa - bb) % _P
        c = (x3 + z3) % _P
        d = (x3 - z3) % _P
        da = d * a % _P
        cb = c * b % _P
        x3 = pow(da + cb, 2, _P)
        z3 = x1 * pow(da - cb, 2, _P) % _P
        x2 = aa * bb % _P
        z2 = e * (aa + _A24 * e % _P) % _P

    if swap:
        x2, x3 = x3, x2
        z2, z3 = z3, z2
    res = x2 * pow(z2, _P - 2, _P) % _P
    return res.to_bytes(32, "little")


_BASE_POINT = (9).to_bytes(32, "little")


def public_from_private(private_b64: str) -> str:
    raw = base64.b64decode(private_b64, validate=True)
    if len(raw) != 32:
        raise ValueError("WireGuard private key must decode to 32 bytes")
    pub = _x25519(raw, _BASE_POINT)
    return base64.b64encode(pub).decode()


def generate_keypair() -> tuple[str, str]:
    priv = _clamp(os.urandom(32))
    priv_b64 = base64.b64encode(priv).decode()
    return priv_b64, public_from_private(priv_b64)
