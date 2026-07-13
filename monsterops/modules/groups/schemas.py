from __future__ import annotations

from pydantic import BaseModel, Field


class RadgroupcheckRow(BaseModel):
    id: int
    groupname: str
    attribute: str
    op: str
    value: str
    model_config = {"from_attributes": True}


class RadgroupreplyRow(BaseModel):
    id: int
    groupname: str
    attribute: str
    op: str
    value: str
    model_config = {"from_attributes": True}


class GroupListItem(BaseModel):
    name: str
    member_count: int = 0
    check_count: int = 0
    reply_count: int = 0


class GroupListResponse(BaseModel):
    total: int
    page: int
    size: int
    items: list[GroupListItem]


class GroupDetail(BaseModel):
    name: str
    check_attrs: list[RadgroupcheckRow]
    reply_attrs: list[RadgroupreplyRow]
    member_count: int
    access_types: list[str] = []


class LoginTypeInfo(BaseModel):
    key: str
    label: str
    description: str
    vendors: list[str]
    detect: str


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class GroupRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class AttributeCreate(BaseModel):
    attribute: str = Field(..., min_length=1)
    op: str = Field(default=":=", max_length=2)
    value: str = Field(..., min_length=1)


class AttributeUpdate(BaseModel):
    op: str | None = None
    value: str | None = None


class MemberOut(BaseModel):
    username: str
    priority: int


class MemberAdd(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    priority: int = 0


class SetAccessTypesBody(BaseModel):
    types: list[str] = Field(default_factory=list)
    enabled: bool = True
