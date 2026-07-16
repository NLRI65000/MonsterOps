from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from monsterops.database import Base


class MrNasManager(Base):
    __tablename__ = "mr_nas_manager"

    id = Column(Integer, primary_key=True)
    nas_id = Column(Integer, ForeignKey("nas.id", ondelete="CASCADE"), unique=True, nullable=False)

    enabled = Column(Boolean, nullable=False, default=True)
    conn_type = Column(String(10), nullable=False, default="ssh")
    netmiko_device_type = Column(String(64), nullable=False)
    host = Column(String(253), nullable=False)
    port = Column(Integer, nullable=False)
    username = Column(String(64), nullable=False)
    secret_enc = Column(Text, nullable=False)

    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    test_status = Column(String(16), nullable=True)
    test_error = Column(Text, nullable=True)

    raw_config = Column(Text, nullable=True)
    config_pulled_at = Column(DateTime(timezone=True), nullable=True)
    config_pushed_at = Column(DateTime(timezone=True), nullable=True)

    history_enabled = Column(Boolean, nullable=False, default=True)
    fetch_interval_hours = Column(Integer, nullable=False, default=24)
    retention_days = Column(Integer, nullable=True)
    last_fetch_at = Column(DateTime(timezone=True), nullable=True)

    last_dispatch_result = Column(Text, nullable=True)

    nas = relationship("Nas", backref="manager", uselist=False)
    versions = relationship(
        "MrNasConfigVersion",
        back_populates="manager",
        cascade="all, delete-orphan",
        order_by="desc(MrNasConfigVersion.created_at)",
    )


class MrNasConfigVersion(Base):

    __tablename__ = "mr_nas_config_version"

    id = Column(Integer, primary_key=True)
    manager_id = Column(
        Integer, ForeignKey("mr_nas_manager.id", ondelete="CASCADE"), nullable=False
    )
    nas_id = Column(Integer, ForeignKey("nas.id", ondelete="CASCADE"), nullable=False)

    config = Column(Text, nullable=False)
    sha256 = Column(String(64), nullable=False)
    byte_size = Column(Integer, nullable=False, default=0)
    line_count = Column(Integer, nullable=False, default=0)
    source = Column(String(16), nullable=False, default="scheduled")
    created_at = Column(DateTime(timezone=True), nullable=False)

    manager = relationship("MrNasManager", back_populates="versions")

    __table_args__ = (Index("ix_nas_config_version_nas_created", "nas_id", "created_at"),)


class MrNasDispatchLog(Base):

    __tablename__ = "mr_nas_dispatch_log"

    id = Column(Integer, primary_key=True)
    nas_id = Column(Integer, ForeignKey("nas.id", ondelete="CASCADE"), nullable=False)
    command = Column(Text, nullable=False)
    output = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="pending")
    error = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=True)
    actor = Column(String(64), nullable=True)
