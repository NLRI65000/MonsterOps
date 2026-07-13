from __future__ import annotations

from datetime import datetime, timezone

import pytest

from monsterops.pagination import decode_cursor, encode_cursor


def test_cursor_roundtrip():
    ts = datetime(2026, 7, 13, 12, 30, 45, 123456, tzinfo=timezone.utc)
    cur = encode_cursor(ts, 4242)
    back_ts, back_id = decode_cursor(cur)
    assert back_ts == ts
    assert back_id == 4242
    assert "=" not in cur and "/" not in cur and "+" not in cur


@pytest.mark.parametrize("bad", ["", "not-base64!!", "Zm9v", "@@@@"])
def test_decode_rejects_garbage(bad):
    with pytest.raises(ValueError):
        decode_cursor(bad)
