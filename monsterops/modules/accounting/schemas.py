from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from monsterops.modules.auth_logs.schemas import GeoInfo


class RadacctOut(BaseModel):
    radacctid: int
    acctsessionid: str
    acctuniqueid: str
    username: str | None
    realm: str | None
    nasipaddress: str
    nasportid: str | None
    nasporttype: str | None
    acctstarttime: datetime | None
    acctupdatetime: datetime | None
    acctstoptime: datetime | None
    acctsessiontime: int | None
    acctinputoctets: int | None
    acctoutputoctets: int | None
    calledstationid: str | None
    callingstationid: str | None
    acctterminatecause: str | None
    framedipaddress: str | None
    active: bool = False
    geo_client: GeoInfo | None = None
    auth_outcome: str | None = None
    auth_log_id: int | None = None

    model_config = {"from_attributes": True}

    @field_validator("nasipaddress", "framedipaddress", mode="before")
    @classmethod
    def coerce_ip(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v)
        return s.split("/")[0] if "/" in s else s


class SessionListParams(BaseModel):
    username: str | None = None
    nasipaddress: str | None = None
    active_only: bool = False
    limit: int = Field(default=100, le=1000)
    offset: int = 0


class CoABody(BaseModel):
    attributes: dict[str, str]


class CoAResult(BaseModel):
    success: bool
    code: int | None
    message: str
