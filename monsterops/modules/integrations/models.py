from __future__ import annotations

from sqlalchemy import Boolean, Column, Integer, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from monsterops.database import Base


class Integration(Base):
    __tablename__ = "mr_integrations"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False, unique=True)
    type = Column(Text, nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
