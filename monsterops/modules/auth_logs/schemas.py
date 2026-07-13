from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class GeoInfo(BaseModel):
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class RadpostauthOut(BaseModel):
    id: int
    username: str
    reply: str | None
    nasipaddress: str | None
    nasidentifier: str | None
    calledstationid: str | None
    callingstationid: str | None
    authmethod: str | None
    failurereason: str | None
    auth_latency_ms: int | None
    authdate: datetime
    geo_client: GeoInfo | None = None
    linked_session_id: int | None = None

    model_config = {"from_attributes": True}

    @field_validator('nasipaddress', mode='before')
    @classmethod
    def coerce_ip(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v)
        return s.split('/')[0] if '/' in s else s


class FailedLoginCount(BaseModel):
    username: str
    count: int


class TimelinePoint(BaseModel):
    hour: datetime
    accept_count: int
    reject_count: int
