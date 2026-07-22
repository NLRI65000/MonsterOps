from __future__ import annotations

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, text
from sqlalchemy.types import TIMESTAMP

from monsterops.database import Base


class MrTacacsClient(Base):

    __tablename__ = "mr_tacacs_client"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    address = Column(String(64), nullable=False, index=True)
    secret_enc = Column(Text, nullable=False)
    nas_id = Column(Integer, ForeignKey("nas.id", ondelete="SET NULL"), nullable=True)
    single_connect = Column(Boolean, nullable=False, server_default=text("false"))
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrTacacsUser(Base):

    __tablename__ = "mr_tacacs_user"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), nullable=False, unique=True, index=True)
    auth_method = Column(String(24), nullable=False, server_default=text("'local_password'"))
    password_hash = Column(String(255), nullable=True)
    identity_source_id = Column(
        Integer, ForeignKey("mr_identity_source.id", ondelete="SET NULL"), nullable=True
    )
    privilege_level = Column(Integer, nullable=False, server_default=text("1"))
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrTacacsCommandRule(Base):

    __tablename__ = "mr_tacacs_command_rule"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer, ForeignKey("mr_tacacs_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order = Column(Integer, nullable=False, server_default=text("0"))
    action = Column(String(8), nullable=False, server_default=text("'permit'"))
    command = Column(String(255), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))


class MrTacacsAcctRecord(Base):

    __tablename__ = "mr_tacacs_acct_record"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), nullable=False, index=True)
    client_id = Column(
        Integer, ForeignKey("mr_tacacs_client.id", ondelete="SET NULL"), nullable=True
    )
    client_name = Column(String(64), nullable=True)
    record_type = Column(String(8), nullable=False, index=True)
    priv_lvl = Column(Integer, nullable=True)
    port = Column(String(64), nullable=True)
    rem_addr = Column(String(64), nullable=True)
    service = Column(String(32), nullable=True)
    cmd = Column(Text, nullable=True)
    task_id = Column(String(64), nullable=True)
    elapsed_time = Column(Integer, nullable=True)
    args = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), nullable=False, index=True, server_default=text("now()")
    )
