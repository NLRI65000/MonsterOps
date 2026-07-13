from __future__ import annotations

from sqlalchemy import BigInteger, Column, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import INET, TIMESTAMP

from monsterops.database import Base


class Radpostauth(Base):
    __tablename__ = "radpostauth"
    __table_args__ = (
        Index("radpostauth_username_idx", "username"),
        Index("ix_radpostauth_authdate", "authdate"),
        Index("ix_radpostauth_keyset", "authdate", "id"),
    )

    id = Column(BigInteger, primary_key=True)
    username = Column(Text, nullable=False)
    password = Column("pass", Text)
    reply = Column(Text)
    nasipaddress = Column(INET)
    nasidentifier = Column(Text)
    calledstationid = Column(Text)
    callingstationid = Column(Text)
    authmethod = Column(Text)
    failurereason = Column(Text)
    auth_latency_ms = Column(Integer)
    authdate = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    acctclass = Column("class", Text)
