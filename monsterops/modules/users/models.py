from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, Index, Integer, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB, VARCHAR

from monsterops.database import Base


class Radcheck(Base):
    __tablename__ = "radcheck"
    __table_args__ = (Index("radcheck_username", "username", "attribute"),)

    id = Column(Integer, primary_key=True)
    username = Column(Text, nullable=False, default="")
    attribute = Column(Text, nullable=False, default="")
    op = Column(VARCHAR(2), nullable=False, default="==")
    value = Column(Text, nullable=False, default="")


class Radreply(Base):
    __tablename__ = "radreply"
    __table_args__ = (Index("radreply_username", "username", "attribute"),)

    id = Column(Integer, primary_key=True)
    username = Column(Text, nullable=False, default="")
    attribute = Column(Text, nullable=False, default="")
    op = Column(VARCHAR(2), nullable=False, default="=")
    value = Column(Text, nullable=False, default="")


class Radusergroup(Base):
    __tablename__ = "radusergroup"
    __table_args__ = (Index("radusergroup_username", "username"),)

    id = Column(Integer, primary_key=True)
    username = Column(Text, nullable=False, default="")
    groupname = Column(Text, nullable=False, default="")
    priority = Column(Integer, nullable=False, default=0)


class MrBulkJob(Base):
    __tablename__ = "mr_bulk_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_type = Column(Text, nullable=False)
    created_by = Column(Text, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), nullable=False,
        default=lambda: datetime.now(tz=timezone.utc),
    )
    row_total = Column(Integer, nullable=False, default=0)
    row_ok = Column(Integer, nullable=False, default=0)
    row_skipped = Column(Integer, nullable=False, default=0)
    row_error = Column(Integer, nullable=False, default=0)
    detail = Column(JSONB, nullable=True)
