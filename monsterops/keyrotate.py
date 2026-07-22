
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.auth.models import AdminTotp
from monsterops.modules.nas.models import (
    Nas,  # noqa: F401 — registers the MrNasManager.nas relationship target
)
from monsterops.modules.nas_manager import crypto
from monsterops.modules.nas_manager.models import MrNasManager
from monsterops.modules.realms.models import MrIdentitySource
from monsterops.modules.tacacs.models import MrTacacsClient

_ENCRYPTED_FIELDS: list[tuple[type[Any], str]] = [
    (MrNasManager, "secret_enc"),
    (MrIdentitySource, "bind_password_enc"),
    (AdminTotp, "secret_enc"),
    (MrTacacsClient, "secret_enc"),
]


@dataclass
class RotationResult:
    counts: dict[str, int] = field(default_factory=dict)
    dry_run: bool = False

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    @property
    def nas_manager(self) -> int:
        return self.counts.get("mr_nas_manager", 0)

    @property
    def identity_sources(self) -> int:
        return self.counts.get("mr_identity_source", 0)

    @property
    def admin_totp(self) -> int:
        return self.counts.get("mr_admin_totp", 0)


async def rotate_secret_key(
    db: AsyncSession, old_key: str, new_key: str, *, dry_run: bool = False
) -> RotationResult:
    if not new_key:
        raise ValueError("new key must not be empty")
    if old_key == new_key:
        raise ValueError("old and new keys are identical — nothing to rotate")

    counts: dict[str, int] = {model.__tablename__: 0 for model, _ in _ENCRYPTED_FIELDS}
    pending: list[tuple[Any, str, str]] = []

    for model, attr in _ENCRYPTED_FIELDS:
        col = getattr(model, attr)
        rows = (await db.execute(select(model).where(col.is_not(None)))).scalars().all()
        for row in rows:
            ct = getattr(row, attr)
            if not ct:
                continue
            try:
                new_ct = crypto.reencrypt(ct, old_key, new_key)
            except Exception as exc:
                raise ValueError(
                    f"failed to decrypt {model.__tablename__}#{row.id} with the old key "
                    f"— aborting, nothing changed ({exc})"
                ) from exc
            pending.append((row, attr, new_ct))
            counts[model.__tablename__] += 1

    if not dry_run:
        for row, attr, new_ct in pending:
            setattr(row, attr, new_ct)
        await db.flush()

    return RotationResult(counts=counts, dry_run=dry_run)
