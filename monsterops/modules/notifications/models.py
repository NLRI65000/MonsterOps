from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Column, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

from monsterops.database import Base


class NotificationChannel(Base):
    __tablename__ = "mr_notification_channels"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False, unique=True)
    type = Column(Text, nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())


class NotificationRule(Base):
    __tablename__ = "mr_notification_rules"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    event_type = Column(Text, nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    channel_id = Column(
        Integer,
        ForeignKey("mr_notification_channels.id", ondelete="SET NULL"),
        nullable=True,
    )
    cooldown_minutes = Column(Integer, nullable=False, default=60)
    enabled = Column(Boolean, nullable=False, default=True)
    last_triggered = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())


class NotificationHistory(Base):
    __tablename__ = "mr_notification_history"

    id = Column(BigInteger, primary_key=True)
    rule_id = Column(
        Integer,
        ForeignKey("mr_notification_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    rule_name = Column(Text, nullable=True)
    channel_id = Column(
        Integer,
        ForeignKey("mr_notification_channels.id", ondelete="SET NULL"),
        nullable=True,
    )
    channel_name = Column(Text, nullable=True)
    event_type = Column(Text, nullable=False)
    subject = Column(Text, nullable=False)
    message = Column(Text, nullable=False)
    status = Column(Text, nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
