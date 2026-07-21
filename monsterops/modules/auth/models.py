from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, Integer, String, Text, func

from monsterops.database import Base


class AdminUser(Base):

    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), nullable=False, unique=True, index=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False, default="readonly")
    is_active = Column(Boolean, nullable=False, default=True)
    totp_required = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class AdminTotp(Base):

    __tablename__ = "mr_admin_totp"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, nullable=False, unique=True, index=True)
    secret_enc = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AdminRecoveryCode(Base):

    __tablename__ = "mr_admin_recovery_code"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, nullable=False, index=True)
    code_hash = Column(String(255), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AuditLog(Base):

    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True)
    admin_id = Column(Integer, nullable=True)
    admin_username = Column(String(64), nullable=False)
    action = Column(String(64), nullable=False)
    target = Column(String(128), nullable=True)
    detail = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
