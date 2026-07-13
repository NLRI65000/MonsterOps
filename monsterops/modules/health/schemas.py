from __future__ import annotations

from pydantic import BaseModel


class ServiceStatus(BaseModel):
    service: str
    active_state: str
    sub_state: str
    load_state: str


class DBHealth(BaseModel):
    ok: bool
    latency_ms: float | None = None


class HealthStatus(BaseModel):
    freeradius: ServiceStatus
    database: DBHealth


class ServiceActionResult(BaseModel):
    action: str
    success: bool
    output: str


class LogFile(BaseModel):
    name: str
    path: str
    exists: bool


class LogTailResponse(BaseModel):
    lines: list[str]
