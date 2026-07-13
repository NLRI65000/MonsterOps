from __future__ import annotations

from sqlalchemy import Boolean, Column, Integer, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from monsterops.database import Base


class MrAutomationRule(Base):

    __tablename__ = "mr_automation_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    event_pattern = Column(Text, nullable=False)
    conditions = Column(JSONB, nullable=True)
    action_type = Column(Text, nullable=False)
    action_config = Column(JSONB, nullable=False, server_default="{}")
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    last_triggered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    trigger_count = Column(Integer, nullable=False, default=0)
