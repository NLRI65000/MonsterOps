from __future__ import annotations

from sqlalchemy import BigInteger, Column, Index, Text
from sqlalchemy.dialects.postgresql import INET, TIMESTAMP
from sqlalchemy import text as sa_text

from monsterops.database import Base


class Radacct(Base):
    __tablename__ = "radacct"
    __table_args__ = (
        Index("radacct_start_user_idx", "acctstarttime", "username"),
        Index(
            "radacct_active_session_idx",
            "acctuniqueid",
            postgresql_where=sa_text("acctstoptime IS NULL"),
        ),
        Index(
            "radacct_bulk_close",
            "nasipaddress",
            "acctstarttime",
            postgresql_where=sa_text("acctstoptime IS NULL"),
        ),
        Index("ix_radacct_keyset", "acctstarttime", "radacctid"),
    )

    radacctid = Column(BigInteger, primary_key=True)
    acctsessionid = Column(Text, nullable=False)
    acctuniqueid = Column(Text, nullable=False, unique=True)
    username = Column(Text)
    realm = Column(Text)
    nasipaddress = Column(INET, nullable=False)
    nasportid = Column(Text)
    nasporttype = Column(Text)
    acctstarttime = Column(TIMESTAMP(timezone=True))
    acctupdatetime = Column(TIMESTAMP(timezone=True))
    acctstoptime = Column(TIMESTAMP(timezone=True))
    acctinterval = Column(BigInteger)
    acctsessiontime = Column(BigInteger)
    acctauthentic = Column(Text)
    connectinfo_start = Column(Text)
    connectinfo_stop = Column(Text)
    acctinputoctets = Column(BigInteger)
    acctoutputoctets = Column(BigInteger)
    calledstationid = Column(Text)
    callingstationid = Column(Text)
    acctterminatecause = Column(Text)
    servicetype = Column(Text)
    framedprotocol = Column(Text)
    framedipaddress = Column(INET)
    framedipv6address = Column(INET)
    framedipv6prefix = Column(INET)
    framedinterfaceid = Column(Text)
    delegatedipv6prefix = Column(INET)
    acctclass = Column("class", Text, index=False)


class Nasreload(Base):
    __tablename__ = "nasreload"

    nasipaddress = Column(INET, primary_key=True)
    reloadtime = Column(TIMESTAMP(timezone=True), nullable=False)
