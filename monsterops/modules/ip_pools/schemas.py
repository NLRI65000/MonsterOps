from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator


class PoolSummary(BaseModel):
    pool_name: str
    total: int
    assigned: int
    free: int


class PoolEntry(BaseModel):
    id: int
    framedipaddress: str
    username: str
    pool_key: str
    nasipaddress: str | None
    callingstationid: str
    expiry_time: datetime | None
    assigned: bool = False
    model_config = {"from_attributes": True}

    @field_validator("framedipaddress", "nasipaddress", mode="before")
    @classmethod
    def coerce_ip(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v)
        return s.split("/")[0] if "/" in s else s

    @model_validator(mode="after")
    def compute_assigned(self) -> "PoolEntry":
        self.assigned = bool(self.username)
        return self


class PoolCreateBody(BaseModel):
    pool_name: str
    cidr: str | None = None
    start_ip: str | None = None
    end_ip: str | None = None


class PoolAddIPsBody(BaseModel):
    cidr: str | None = None
    start_ip: str | None = None
    end_ip: str | None = None


class PoolRenameBody(BaseModel):
    new_name: str
