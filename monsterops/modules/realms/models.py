from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP

from monsterops.database import Base


class HomeServer(Base):
    __tablename__ = "mr_home_server"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    host = Column(Text, nullable=False)
    auth_port = Column(Integer, nullable=False, default=1812)
    acct_port = Column(Integer, nullable=False, default=1813)
    secret = Column(Text, nullable=False)
    type = Column(String(8), nullable=False, default="auth")
    response_window = Column(Integer, nullable=False, default=20)
    zombie_period = Column(Integer, nullable=False, default=40)
    revive_interval = Column(Integer, nullable=False, default=120)
    vpn_interface = Column(String(32))

    status = Column(String(16), nullable=False, default="unknown")
    last_rtt_ms = Column(Float)
    last_seen_at = Column(TIMESTAMP(timezone=True))
    last_probe_at = Column(TIMESTAMP(timezone=True))

    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class HomeServerPool(Base):
    __tablename__ = "mr_home_server_pool"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    pool_type = Column(String(24), nullable=False, default="fail-over")
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class HomeServerPoolMember(Base):
    __tablename__ = "mr_home_server_pool_member"
    __table_args__ = (UniqueConstraint("pool_id", "server_id", name="uq_pool_server"),)

    id = Column(Integer, primary_key=True)
    pool_id = Column(Integer, ForeignKey("mr_home_server_pool.id", ondelete="CASCADE"), nullable=False)
    server_id = Column(Integer, ForeignKey("mr_home_server.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)


class Realm(Base):
    __tablename__ = "mr_realm"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, unique=True)
    pool_id = Column(Integer, ForeignKey("mr_home_server_pool.id", ondelete="SET NULL"))
    strip_username = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class NasGroupRealm(Base):
    __tablename__ = "mr_nas_group_realm"
    __table_args__ = (UniqueConstraint("nas_group_id", "realm_id", name="uq_nasgroup_realm"),)

    id = Column(Integer, primary_key=True)
    nas_group_id = Column(Integer, ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False)
    realm_id = Column(Integer, ForeignKey("mr_realm.id", ondelete="CASCADE"), nullable=False)
