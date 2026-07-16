from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_REALM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:-]{0,253}$")
_IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")

ServerType = Literal["auth", "acct", "both"]
PoolType = Literal["fail-over", "load-balance", "client-balance", "client-port-balance"]
LdapEncryption = Literal["none", "starttls", "ldaps"]
LdapLoginAttr = Literal["userPrincipalName", "sAMAccountName", "mail"]
LdapDeprovision = Literal["disable", "delete"]
AuthMethod = Literal["local_password", "directory_delegated"]
SourceType = Literal["active_directory"]
ImportMode = Literal["all", "selected"]


def _check(pattern: re.Pattern[str], v: str, what: str) -> str:
    if not pattern.match(v):
        raise ValueError(f"invalid {what}: only letters, digits and . _ - are allowed")
    return v


def _ldap_value(v: str, what: str) -> str:
    if '"' in v or "\\" in v or any(ord(c) < 0x20 for c in v):
        raise ValueError(f"{what} must not contain quotes, backslashes or control characters")
    return v




class HomeServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    host: str = Field(..., min_length=1, max_length=254)
    auth_port: int = Field(1812, ge=1, le=65535)
    acct_port: int = Field(1813, ge=1, le=65535)
    secret: str = Field(..., min_length=1, max_length=128)
    type: ServerType = "auth"
    response_window: int = Field(20, ge=1, le=300)
    zombie_period: int = Field(40, ge=1, le=600)
    revive_interval: int = Field(120, ge=10, le=3600)
    vpn_interface: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "server name")

    @field_validator("host")
    @classmethod
    def _host(cls, v: str) -> str:
        return _check(_HOST_RE, v, "host")

    @field_validator("secret")
    @classmethod
    def _secret(cls, v: str) -> str:
        if any(c in v for c in '"\\\n\r') or any(ord(c) < 0x20 for c in v):
            raise ValueError("secret must not contain quotes, backslashes or control characters")
        return v

    @field_validator("vpn_interface")
    @classmethod
    def _iface(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return _check(_IFACE_RE, v, "VPN interface name")


class HomeServerUpdate(HomeServerCreate):
    secret: str = Field("", max_length=128)


class HomeServerOut(BaseModel):
    id: int
    name: str
    host: str
    auth_port: int
    acct_port: int
    type: ServerType
    response_window: int
    zombie_period: int
    revive_interval: int
    vpn_interface: str | None
    status: str
    last_rtt_ms: float | None
    last_seen_at: datetime | None
    last_probe_at: datetime | None
    vpn_interface_up: bool | None = None
    created_at: datetime
    model_config = {"from_attributes": True}




class PoolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    pool_type: PoolType = "fail-over"
    server_ids: list[int] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "pool name")


class PoolOut(BaseModel):
    id: int
    name: str
    pool_type: PoolType
    server_ids: list[int]
    server_names: list[str]
    status: str
    created_at: datetime




class RealmCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    pool_id: int | None = None
    strip_username: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_REALM_RE, v, "realm name")


class RealmOut(BaseModel):
    id: int
    name: str
    pool_id: int | None
    pool_name: str | None
    strip_username: bool
    status: str
    last_rtt_ms: float | None
    last_probe_at: datetime | None
    created_at: datetime




class IdentitySourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    source_type: SourceType = "active_directory"
    host: str = Field(..., min_length=1, max_length=254)
    port: int = Field(389, ge=1, le=65535)
    encryption: LdapEncryption = "none"
    base_dn: str = Field(..., min_length=1, max_length=512)
    bind_dn: str | None = Field(None, max_length=512)
    bind_password: str | None = Field(None, max_length=256)
    tls_verify: bool = True
    timeout: int = Field(10, ge=1, le=120)
    login_attribute: LdapLoginAttr = "userPrincipalName"
    strip_login_suffix: bool = False
    user_search_base: str | None = Field(None, max_length=512)
    user_search_filter: str = Field(
        "(&(objectCategory=person)(objectClass=user))",
        min_length=1,
        max_length=512,
    )

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "identity source name")

    @field_validator("host")
    @classmethod
    def _host(cls, v: str) -> str:
        return _check(_HOST_RE, v, "host")

    @field_validator("base_dn")
    @classmethod
    def _base_dn(cls, v: str) -> str:
        return _ldap_value(v, "base DN")

    @field_validator("bind_dn")
    @classmethod
    def _bind_dn(cls, v: str | None) -> str | None:
        return None if v is None else _ldap_value(v, "bind DN")

    @field_validator("bind_password")
    @classmethod
    def _bind_password(cls, v: str | None) -> str | None:
        return None if v is None else _ldap_value(v, "bind password")

    @field_validator("user_search_filter")
    @classmethod
    def _filter(cls, v: str) -> str:
        return _ldap_value(v, "LDAP filter")

    @field_validator("user_search_base")
    @classmethod
    def _search_base(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return _ldap_value(v, "user search base")


class IdentitySourceOut(BaseModel):
    id: int
    name: str
    source_type: SourceType
    host: str
    port: int
    encryption: LdapEncryption
    base_dn: str
    bind_dn: str | None
    has_bind_password: bool
    tls_verify: bool
    timeout: int
    login_attribute: LdapLoginAttr
    strip_login_suffix: bool
    user_search_base: str | None
    user_search_filter: str
    status: str
    last_rtt_ms: float | None
    last_probe_at: datetime | None
    created_at: datetime




class AuthDomainCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str | None = Field(None, max_length=512)
    auth_method: AuthMethod = "local_password"
    enabled: bool = True
    is_default: bool = False
    default_groupname: str | None = Field(None, max_length=128)
    deprovision_action: LdapDeprovision = "disable"
    ad_short_domain: str | None = Field(None, max_length=64)
    import_mode: ImportMode = "all"
    sync_enabled: bool = False
    sync_interval_minutes: int = Field(60, ge=5, le=10080)
    nas_group_ids: list[int] = []
    identity_source: IdentitySourceCreate | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _check(_NAME_RE, v, "realm name")

    @field_validator("ad_short_domain")
    @classmethod
    def _short_domain(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return _check(_NAME_RE, v, "AD short domain")

    @model_validator(mode="after")
    def _method_requirements(self):
        if self.auth_method == "directory_delegated":
            if self.identity_source is None:
                raise ValueError("directory_delegated requires an identity source")
            if not self.ad_short_domain:
                raise ValueError("directory_delegated requires ad_short_domain")
        return self


class AuthDomainOut(BaseModel):
    id: int
    name: str
    description: str | None
    auth_method: AuthMethod
    enabled: bool
    is_default: bool
    default_groupname: str | None
    deprovision_action: LdapDeprovision
    ad_short_domain: str | None
    import_mode: ImportMode
    sync_enabled: bool
    sync_interval_minutes: int
    last_sync_at: datetime | None
    last_sync_status: str | None
    last_sync_stats: dict | None
    identity_source: IdentitySourceOut | None
    nas_group_ids: list[int]
    nas_group_names: list[str]
    supported_protocols: list[str]
    server_requirements: list[str]
    created_at: datetime


class LdapTestResult(BaseModel):
    status: str
    message: str
    rtt_ms: float | None


class HostCheck(BaseModel):
    key: str
    label: str
    status: str
    detail: str


class HostDelegationStatus(BaseModel):

    ready: bool
    checks: list[HostCheck]




class LdapGroupMapCreate(BaseModel):
    ad_group: str = Field(..., min_length=1, max_length=512)
    groupname: str = Field(..., min_length=1, max_length=128)
    priority: int = Field(0, ge=0, le=1000)


class LdapGroupMapOut(BaseModel):
    id: int
    auth_domain_id: int
    ad_group: str
    groupname: str
    priority: int
    model_config = {"from_attributes": True}


class LdapAdGroup(BaseModel):
    cn: str
    dn: str


class LdapSyncResult(BaseModel):
    status: str
    dry_run: bool
    created: int = 0
    updated: int = 0
    reactivated: int = 0
    disabled: int = 0
    removed: int = 0
    unchanged: int = 0
    errors: int = 0
    message: str | None = None
    sample: list[str] = []


class LdapSyncRun(BaseModel):
    run_at: datetime
    status: str
    data: dict | None
    error_message: str | None




class AuthImportCandidate(BaseModel):
    guid: str
    username: str
    enabled: bool
    group: str | None
    dn: str
    imported: bool


class AuthImportCandidates(BaseModel):
    status: str
    message: str | None = None
    total: int = 0
    candidates: list[AuthImportCandidate] = []


class AuthImportRequest(BaseModel):
    guids: list[str] = Field(..., min_length=1, max_length=5000)




class NasGroupRealmCreate(BaseModel):
    nas_group_id: int
    realm_id: int


class NasGroupRealmOut(BaseModel):
    id: int
    nas_group_id: int
    nas_group_name: str
    realm_id: int
    realm_name: str




class ProxyConfPreview(BaseModel):
    content: str
    path: str


class ProxyConfApplyResult(BaseModel):
    written: bool
    path: str
    bytes: int
    restart_triggered: bool
