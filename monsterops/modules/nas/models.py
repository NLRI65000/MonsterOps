from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text

from monsterops.database import Base


class Nas(Base):
    __tablename__ = "nas"
    __table_args__ = (Index("nas_nasname", "nasname"),)

    id = Column(Integer, primary_key=True)
    nasname = Column(Text, nullable=False)
    shortname = Column(Text, nullable=False, default="")
    type = Column(Text, nullable=False, default="other")
    ports = Column(Integer)
    secret = Column(Text, nullable=False)
    server = Column(Text)
    community = Column(Text)
    description = Column(Text)


class NasGroup(Base):
    __tablename__ = "mr_nas_group"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False, unique=True)
    description = Column(String(200))


class NasGroupMember(Base):

    __tablename__ = "mr_nas_group_member"

    id = Column(Integer, primary_key=True)
    nas_group_id = Column(
        Integer, ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False
    )
    nas_id = Column(Integer, ForeignKey("nas.id", ondelete="CASCADE"), nullable=False)


class RadiusGroupNasGroup(Base):

    __tablename__ = "mr_radius_group_nas_group"

    id = Column(Integer, primary_key=True)
    radius_groupname = Column(String(64), nullable=False)
    nas_group_id = Column(
        Integer, ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False
    )
