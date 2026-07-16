from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

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
    pool_id = Column(
        Integer, ForeignKey("mr_home_server_pool.id", ondelete="CASCADE"), nullable=False
    )
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
    nas_group_id = Column(
        Integer, ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False
    )
    realm_id = Column(Integer, ForeignKey("mr_realm.id", ondelete="CASCADE"), nullable=False)


class MrIdentitySource(Base):

    __tablename__ = "mr_identity_source"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    source_type = Column(String(24), nullable=False, server_default=text("'active_directory'"))
    host = Column(Text, nullable=False)
    port = Column(Integer, nullable=False, default=389)
    encryption = Column(String(10), nullable=False, default="none")
    base_dn = Column(Text, nullable=False)
    bind_dn = Column(Text)
    bind_password_enc = Column(Text)
    tls_verify = Column(Boolean, nullable=False, default=True)
    timeout = Column(Integer, nullable=False, default=10)
    login_attribute = Column(String(64), nullable=False, server_default=text("'userPrincipalName'"))
    strip_login_suffix = Column(Boolean, nullable=False, server_default=text("false"))
    user_search_base = Column(Text)
    user_search_filter = Column(
        Text,
        nullable=False,
        server_default=text("'(&(objectCategory=person)(objectClass=user))'"),
    )

    status = Column(String(16), nullable=False, default="unknown")
    last_rtt_ms = Column(Float)
    last_seen_at = Column(TIMESTAMP(timezone=True))
    last_probe_at = Column(TIMESTAMP(timezone=True))

    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrAuthDomain(Base):

    __tablename__ = "mr_auth_domain"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    description = Column(Text)
    identity_source_id = Column(Integer, ForeignKey("mr_identity_source.id", ondelete="SET NULL"))
    auth_method = Column(String(24), nullable=False, server_default=text("'local_password'"))
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    is_default = Column(Boolean, nullable=False, server_default=text("false"))

    default_groupname = Column(Text)
    deprovision_action = Column(
        String(8), nullable=False, server_default=text("'disable'")
    )

    ad_short_domain = Column(String(64))

    import_mode = Column(String(8), nullable=False, server_default=text("'all'"))

    sync_enabled = Column(Boolean, nullable=False, server_default=text("false"))
    sync_interval_minutes = Column(Integer, nullable=False, server_default=text("60"))
    last_sync_at = Column(TIMESTAMP(timezone=True))
    last_sync_status = Column(String(16))
    last_sync_stats = Column(JSONB)

    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrAuthGroupMap(Base):

    __tablename__ = "mr_auth_group_map"
    __table_args__ = (UniqueConstraint("auth_domain_id", "ad_group", name="uq_auth_group_map"),)

    id = Column(Integer, primary_key=True)
    auth_domain_id = Column(
        Integer, ForeignKey("mr_auth_domain.id", ondelete="CASCADE"), nullable=False
    )
    ad_group = Column(Text, nullable=False)
    groupname = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False, default=0)


class MrAuthSyncedUser(Base):

    __tablename__ = "mr_auth_synced_user"
    __table_args__ = (
        Index("ix_mr_auth_synced_user_domain", "auth_domain_id"),
        Index("ix_mr_auth_synced_user_username", "username"),
    )

    id = Column(Integer, primary_key=True)
    auth_domain_id = Column(
        Integer, ForeignKey("mr_auth_domain.id", ondelete="CASCADE"), nullable=False
    )
    ad_object_guid = Column(Text, nullable=False, unique=True)
    username = Column(Text, nullable=False)
    ad_dn = Column(Text)
    ad_enabled = Column(Boolean, nullable=False, default=True)
    groupname = Column(Text)
    last_seen_at = Column(TIMESTAMP(timezone=True))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrAuthDomainNasGroup(Base):

    __tablename__ = "mr_auth_domain_nas_group"
    __table_args__ = (
        UniqueConstraint("auth_domain_id", "nas_group_id", name="uq_auth_domain_nas_group"),
    )

    id = Column(Integer, primary_key=True)
    auth_domain_id = Column(
        Integer, ForeignKey("mr_auth_domain.id", ondelete="CASCADE"), nullable=False
    )
    nas_group_id = Column(
        Integer, ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False
    )
