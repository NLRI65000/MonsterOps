from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from monsterops.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MrFirewallConfig(Base):
    __tablename__ = "mr_firewall_config"

    id = Column(Integer, primary_key=True)
    managed = Column(Boolean, nullable=False, default=False)
    default_input_policy = Column(String(8), nullable=False, default="drop")
    default_forward_policy = Column(String(8), nullable=False, default="drop")
    allow_ping = Column(Boolean, nullable=False, default=True)
    ssh_guard_port = Column(Integer, nullable=False, default=22)
    web_guard_port = Column(Integer, nullable=False, default=8000)
    confirm_timeout = Column(Integer, nullable=False, default=60)
    autoblock_enabled = Column(Boolean, nullable=False, default=False)
    autoblock_threshold = Column(Integer, nullable=False, default=10)
    autoblock_window = Column(Integer, nullable=False, default=10)
    autoblock_ban_seconds = Column(Integer, nullable=False, default=3600)
    last_applied_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class MrFirewallRule(Base):
    __tablename__ = "mr_firewall_rule"

    id = Column(Integer, primary_key=True)
    position = Column(Integer, nullable=False, default=0)
    enabled = Column(Boolean, nullable=False, default=True)
    chain = Column(String(8), nullable=False, default="input")
    action = Column(String(8), nullable=False, default="accept")
    protocol = Column(String(8), nullable=True)
    saddr = Column(String(64), nullable=True)
    daddr = Column(String(64), nullable=True)
    sport = Column(String(48), nullable=True)
    dport = Column(String(48), nullable=True)
    iifname = Column(String(32), nullable=True)
    oifname = Column(String(32), nullable=True)
    ct_state = Column(String(48), nullable=True)
    src_set = Column(String(48), nullable=True)
    comment = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class MrFirewallSet(Base):
    __tablename__ = "mr_firewall_set"

    id = Column(Integer, primary_key=True)
    name = Column(String(48), nullable=False, unique=True)
    family = Column(String(12), nullable=False, default="ipv4_addr")
    kind = Column(String(12), nullable=False, default="block")
    auto_ban = Column(Boolean, nullable=False, default=False)
    managed_source = Column(String(48), nullable=True)
    comment = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    entries = relationship("MrFirewallSetEntry", back_populates="fset",
                           cascade="all, delete-orphan")


class MrFirewallSetEntry(Base):
    __tablename__ = "mr_firewall_set_entry"

    id = Column(Integer, primary_key=True)
    set_id = Column(Integer, ForeignKey("mr_firewall_set.id", ondelete="CASCADE"), nullable=False)
    element = Column(String(64), nullable=False)
    comment = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    fset = relationship("MrFirewallSet", back_populates="entries")


class MrFirewallSnapshot(Base):
    __tablename__ = "mr_firewall_snapshot"

    id = Column(Integer, primary_key=True)
    nft_text = Column(Text, nullable=False)
    note = Column(String(200), nullable=True)
    actor = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)


class MrFirewallBlockEvent(Base):
    __tablename__ = "mr_firewall_block_event"

    id = Column(BigInteger, primary_key=True)
    element = Column(String(64), nullable=False)
    source = Column(String(32), nullable=False, default="brute_force")
    reason = Column(String(200), nullable=True)
    set_name = Column(String(48), nullable=False)
    ban_seconds = Column(Integer, nullable=True)
    override_by = Column(String(64), nullable=True)
    override_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False, index=True)
