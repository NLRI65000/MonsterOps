
from __future__ import annotations

import base64
from datetime import datetime


def encode_cursor(ts: datetime, row_id: int) -> str:
    raw = f"{ts.isoformat()}|{int(row_id)}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        pad = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + pad).decode()
        ts_str, id_str = raw.rsplit("|", 1)
        return datetime.fromisoformat(ts_str), int(id_str)
    except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error) as exc:
        raise ValueError(f"invalid cursor: {cursor!r}") from exc
