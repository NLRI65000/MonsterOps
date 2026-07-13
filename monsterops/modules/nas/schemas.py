from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class NasOut(BaseModel):
    id: int
    nasname: str
    shortname: str
    type: str
    ports: int | None
    secret: str
    server: str | None
    community: str | None
    description: str | None

    model_config = {"from_attributes": True}


class NasListItem(BaseModel):
    id: int
    nasname: str
    shortname: str
    type: str
    description: str | None
    active_sessions: int


class NasListResponse(BaseModel):
    total: int
    page: int
    size: int
    items: list[NasListItem]


class NasCreate(BaseModel):
    nasname: str = Field(..., min_length=1, max_length=128, description="NAS IP, CIDR, or hostname")
    shortname: str = Field(default="", max_length=32)
    type: str = Field(default="other", max_length=30)
    ports: int | None = Field(default=None, ge=1, le=65535)
    secret: str = Field(..., min_length=1, max_length=60)
    server: str | None = Field(default=None, max_length=64)
    community: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=200)

    @field_validator("nasname", "secret", mode="before")
    @classmethod
    def strip_whitespace(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class NasUpdate(BaseModel):
    nasname: str | None = Field(default=None, min_length=1, max_length=128)
    shortname: str | None = Field(default=None, max_length=32)
    type: str | None = Field(default=None, max_length=30)
    ports: int | None = Field(default=None, ge=1, le=65535)
    secret: str | None = Field(default=None, min_length=1, max_length=60)
    server: str | None = Field(default=None, max_length=64)
    community: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=200)

    @field_validator("nasname", "secret", mode="before")
    @classmethod
    def strip_whitespace(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class NasSessionOut(BaseModel):
    radacctid: int
    username: str | None
    nasportid: str | None
    framedipaddress: str | None
    callingstationid: str | None
    acctstarttime: datetime | None
    acctsessiontime: int | None
    acctinputoctets: int | None
    acctoutputoctets: int | None

    model_config = {"from_attributes": True}



class NasGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class NasGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class NasGroupOut(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {"from_attributes": True}


class NasGroupListItem(BaseModel):
    id: int
    name: str
    description: str | None
    device_count: int
    radius_group_count: int


class NasGroupListResponse(BaseModel):
    total: int
    page: int
    size: int
    items: list[NasGroupListItem]


class NasGroupMemberOut(BaseModel):
    id: int
    nas_id: int
    nasname: str
    shortname: str
    type: str


class RadiusGroupLink(BaseModel):
    id: int | None = None
    radius_groupname: str = Field(..., min_length=1, max_length=64)
