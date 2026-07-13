from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class PeriodPoint(BaseModel):
    period: datetime
    accept_count: int = 0
    reject_count: int = 0


class BandwidthPoint(BaseModel):
    period: datetime
    input_bytes: int = 0
    output_bytes: int = 0


class TopUser(BaseModel):
    username: str
    session_count: int = 0
    input_bytes: int = 0
    output_bytes: int = 0
    online_seconds: int = 0


class NasTraffic(BaseModel):
    nas_ip: str
    nas_name: str | None = None
    input_bytes: int = 0
    output_bytes: int = 0
    session_count: int = 0


class OnlineTimeEntry(BaseModel):
    username: str
    total_seconds: int = 0
    session_count: int = 0
