from __future__ import annotations

from typing import List

from sqlalchemy import ARRAY, Boolean, Column, Integer, Text, TIMESTAMP
from sqlalchemy.sql import func

from monsterops.database import Base


class MrWebhookSub(Base):

    __tablename__ = "mr_webhook_subs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    url = Column(Text, nullable=False)
    secret = Column(Text, nullable=True)
    events: List[str] = Column(ARRAY(Text), nullable=False, default=list)  # type: ignore[assignment]
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
