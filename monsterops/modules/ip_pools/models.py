from __future__ import annotations

from sqlalchemy import BigInteger, Column, Text
from sqlalchemy.dialects.postgresql import INET, TIMESTAMP

from monsterops.database import Base


class Radippool(Base):
    __tablename__ = "radippool"

    id = Column(BigInteger, primary_key=True)
    pool_name = Column(Text, nullable=False)
    framedipaddress = Column(INET, nullable=False)
    nasipaddress = Column(INET, nullable=False, default="0.0.0.0")
    calledstationid = Column(Text, nullable=False, default="")
    callingstationid = Column(Text, nullable=False, default="")
    expiry_time = Column(TIMESTAMP(timezone=True))
    username = Column(Text, nullable=False, default="")
    pool_key = Column(Text, nullable=False, default="")
