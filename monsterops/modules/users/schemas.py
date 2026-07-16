from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from monsterops.modules.auth_logs.schemas import GeoInfo

PasswordType = Literal[
    "Cleartext-Password",
    "MD5-Password",
    "NT-Password",
    "SHA-Password",
    "Crypt-Password",
]


class RadcheckRow(BaseModel):
    id: int
    username: str
    attribute: str
    op: str
    value: str
    model_config = {"from_attributes": True}


class RadreplyRow(BaseModel):
    id: int
    username: str
    attribute: str
    op: str
    value: str
    model_config = {"from_attributes": True}


class RadusergroupRow(BaseModel):
    id: int
    username: str
    groupname: str
    priority: int
    model_config = {"from_attributes": True}


class UserListItem(BaseModel):
    username: str
    disabled: bool
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None
    source: str = "local"
    source_realm: str | None = None


class UserListResponse(BaseModel):
    total: int
    page: int
    size: int
    items: list[UserListItem]


class UserDetail(BaseModel):
    username: str
    disabled: bool
    groups: list[RadusergroupRow]
    check_attrs: list[RadcheckRow]
    reply_attrs: list[RadreplyRow]
    source: str = "local"
    source_realm: str | None = None


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)
    password_type: PasswordType = "Cleartext-Password"
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
            raise ValueError("username must not contain control characters")
        forbidden = set("<>\"'`&")
        if forbidden & set(v):
            raise ValueError("username must not contain any of these characters: < > \" ' ` &")
        return v


class UserUpdate(BaseModel):
    password: str | None = None
    password_type: PasswordType | None = None
    expiration: str | None = None
    simultaneous_use: int | None = None


class AttributeCreate(BaseModel):
    attribute: str = Field(..., min_length=1)
    op: str = Field(default=":=", max_length=2)
    value: str = Field(..., min_length=1)


class AttributeUpdate(BaseModel):
    op: str | None = None
    value: str | None = None


class GroupAssign(BaseModel):
    groups: list[str]


class SessionOut(BaseModel):
    radacctid: int
    nasipaddress: str | None
    nasportid: str | None
    acctstarttime: datetime | None
    acctstoptime: datetime | None
    acctsessiontime: int | None
    acctinputoctets: int | None
    acctoutputoctets: int | None
    acctterminatecause: str | None
    callingstationid: str | None
    calledstationid: str | None
    framedipaddress: str | None
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


class BulkUsernameList(BaseModel):
    usernames: list[str] = Field(default_factory=list)


class BulkGroupAssign(BaseModel):
    usernames: list[str] = Field(default_factory=list)
    group: str = Field(..., min_length=1)


class ImportRow(BaseModel):
    username: str
    password: str
    password_type: PasswordType = "Cleartext-Password"
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None


class ImportPreviewRow(BaseModel):
    row: int
    username: str
    password: str = ""
    password_type: str = "Cleartext-Password"
    groups: list[str] = []
    expiration: str | None = None
    simultaneous_use: int | None = None
    status: str
    error: str | None = None


class ImportPreviewResponse(BaseModel):
    rows: list[ImportPreviewRow]
    new_count: int
    exists_count: int
    error_count: int


class ImportCommitRequest(BaseModel):
    rows: list[ImportRow]
    skip_existing: bool = True


class ImportCommitResponse(BaseModel):
    created: int
    skipped: int
    errors: list[dict]


class AuthHistoryOut(BaseModel):
    id: int
    reply: str | None
    authdate: datetime
    nasipaddress: str | None
    nasidentifier: str | None
    callingstationid: str | None
    calledstationid: str | None
    authmethod: str | None = None
    failurereason: str | None = None
    auth_latency_ms: int | None = None
    geo_client: GeoInfo | None = None
    linked_session_id: int | None = None
    model_config = {"from_attributes": True}

    @field_validator("nasipaddress", mode="before")
    @classmethod
    def coerce_nas_ip(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v)
        return s.split("/")[0] if "/" in s else s


class TimelineEvent(BaseModel):

    type: Literal["auth", "session"]
    timestamp: datetime
    auth_log_id: int | None = None
    reply: str | None = None
    authmethod: str | None = None
    failurereason: str | None = None
    auth_latency_ms: int | None = None
    session_id: int | None = None
    acctstarttime: datetime | None = None
    acctstoptime: datetime | None = None
    acctsessiontime: int | None = None
    acctinputoctets: int | None = None
    acctoutputoctets: int | None = None
    acctterminatecause: str | None = None
    framedipaddress: str | None = None
    auth_outcome: str | None = None
    auth_log_ref: int | None = None
    nasipaddress: str | None = None
    nasidentifier: str | None = None
    callingstationid: str | None = None
    calledstationid: str | None = None
    geo_client: GeoInfo | None = None
