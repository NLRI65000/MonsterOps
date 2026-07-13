from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from monsterops.modules.auth_logs.schemas import GeoInfo


class RecentAuth(BaseModel):
    username: str
    reply: str
    authdate: datetime
    callingstationid: str | None
    calledstationid: str | None


class TopUser(BaseModel):
    username: str
    bytes_in: int
    bytes_out: int
    total_bytes: int


class DashboardStats(BaseModel):
    range: str
    active_sessions: int
    logins: int
    failed_logins: int
    bytes_in: int
    bytes_out: int
    user_count: int
    nas_count: int
    recent_auth: list[RecentAuth]
    top_bandwidth: list[TopUser]


class OnlineUser(BaseModel):
    username: str
    nasipaddress: str | None
    nasname: str | None
    acctstarttime: datetime | None
    framedipaddress: str | None
    callingstationid: str | None
    geo_client: GeoInfo | None = None


class NasStatus(BaseModel):
    id: int
    shortname: str
    nasname: str
    type: str
    online: bool
    session_count: int


class SessionType(BaseModel):
    porttype: str
    count: int
