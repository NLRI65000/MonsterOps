from __future__ import annotations

import difflib
import hashlib
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.nas_manager.models import MrNasConfigVersion, MrNasManager

_TS_PATTERNS = [
    re.compile(r"(?:[A-Za-z]{3}/\d{1,2}|\d{1,2}/[A-Za-z]{3})/\d{4}\s+\d{2}:\d{2}:\d{2}"),
    re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"),
    re.compile(r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:\s+\w+)?\s+\d{4}"),
    re.compile(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\w+\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}"),
]
_TS_TOKEN = "<timestamp>"


def normalize_config(text: str) -> str:
    lines_out = []
    for line in (text or "").splitlines():
        masked = line
        if line.lstrip().startswith(("#", "!", ";")):
            for pat in _TS_PATTERNS:
                masked = pat.sub(_TS_TOKEN, masked)
        else:
            masked = _TS_PATTERNS[1].sub(_TS_TOKEN, masked)
        lines_out.append(masked)
    return "\n".join(lines_out)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


async def store_version(
    db: AsyncSession, manager: MrNasManager, config: str, source: str
) -> MrNasConfigVersion | None:
    if not config or not config.strip():
        return None

    latest = (await db.execute(
        select(MrNasConfigVersion)
        .where(MrNasConfigVersion.manager_id == manager.id)
        .order_by(MrNasConfigVersion.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if latest is not None and normalize_config(latest.config) == normalize_config(config):
        return None
    sha = _sha(config)

    version = MrNasConfigVersion(
        manager_id=manager.id,
        nas_id=manager.nas_id,
        config=config,
        sha256=sha,
        byte_size=len(config.encode()),
        line_count=len(config.splitlines()),
        source=source,
        created_at=datetime.now(timezone.utc),
    )
    db.add(version)
    await db.flush()
    return version


async def apply_retention(db: AsyncSession, manager: MrNasManager) -> int:
    days = manager.retention_days
    if not days or days <= 0:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    latest_id = (await db.execute(
        select(MrNasConfigVersion.id)
        .where(MrNasConfigVersion.manager_id == manager.id)
        .order_by(MrNasConfigVersion.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    stmt = delete(MrNasConfigVersion).where(
        MrNasConfigVersion.manager_id == manager.id,
        MrNasConfigVersion.created_at < cutoff,
    )
    if latest_id is not None:
        stmt = stmt.where(MrNasConfigVersion.id != latest_id)

    result = await db.execute(stmt.execution_options(synchronize_session=False))
    return result.rowcount or 0


def diff_stats(old_text: str, new_text: str) -> tuple[int, int]:
    added = removed = 0
    for line in difflib.unified_diff(
        normalize_config(old_text).splitlines(),
        normalize_config(new_text).splitlines(),
        lineterm="",
    ):
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed


def unified_diff(old_text: str, new_text: str, from_label: str, to_label: str) -> str:
    return "\n".join(difflib.unified_diff(
        normalize_config(old_text).splitlines(),
        normalize_config(new_text).splitlines(),
        fromfile=from_label,
        tofile=to_label,
        lineterm="",
    ))
