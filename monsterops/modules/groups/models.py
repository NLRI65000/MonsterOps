from __future__ import annotations

from sqlalchemy import Column, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import VARCHAR

from monsterops.database import Base


class GroupAccessType(Base):
    __tablename__ = "group_access_types"
    __table_args__ = (
        UniqueConstraint("groupname", "login_type", name="uq_group_login_type"),
        Index("ix_group_access_types_groupname", "groupname"),
    )

    id = Column(Integer, primary_key=True)
    groupname = Column(Text, nullable=False)
    login_type = Column(Text, nullable=False)


class Radgroupcheck(Base):
    __tablename__ = "radgroupcheck"
    __table_args__ = (Index("radgroupcheck_groupname", "groupname", "attribute"),)

    id = Column(Integer, primary_key=True)
    groupname = Column(Text, nullable=False, default="")
    attribute = Column(Text, nullable=False, default="")
    op = Column(VARCHAR(2), nullable=False, default="==")
    value = Column(Text, nullable=False, default="")


class Radgroupreply(Base):
    __tablename__ = "radgroupreply"
    __table_args__ = (Index("radgroupreply_groupname", "groupname", "attribute"),)

    id = Column(Integer, primary_key=True)
    groupname = Column(Text, nullable=False, default="")
    attribute = Column(Text, nullable=False, default="")
    op = Column(VARCHAR(2), nullable=False, default="=")
    value = Column(Text, nullable=False, default="")
