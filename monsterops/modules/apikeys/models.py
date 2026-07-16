from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import TIMESTAMP, Boolean, Column, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY

from monsterops.database import Base


class ApiKey(Base):
    __tablename__ = "mr_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    key_prefix = Column(Text, nullable=False)
    key_hash = Column(Text, nullable=False, unique=True)
    scopes = Column(ARRAY(Text), nullable=False, server_default="{}")  # type: ignore[var-annotated]
    created_by = Column(Integer, nullable=True)
    last_used_at = Column(TIMESTAMP(timezone=True), nullable=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )
