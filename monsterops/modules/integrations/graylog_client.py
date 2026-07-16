from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_SKIP_FIELDS = frozenset(
    {"_id", "gl2_message_id", "gl2_source_node", "gl2_source_input", "gl2_remote_ip"}
)


class GraylogClient:
    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        stream_id: str | None = None,
        verify_ssl: bool = False,
        timeout: int = 10,
        nas_ip_field: str = "source",
        username_field: str = "",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth = (username, password)
        self.stream_id = stream_id
        self.verify = verify_ssl
        self.timeout = timeout
        self.nas_ip_field = nas_ip_field or "source"
        self.username_field = username_field or ""
        self._headers = {"Accept": "application/json", "X-Requested-By": "MonsterOps"}

    async def test_connection(self) -> dict[str, Any]:
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as c:
            r = await c.get(f"{self.base_url}/api/system", auth=self.auth, headers=self._headers)
            r.raise_for_status()
            data = r.json()
            return {
                "version": data.get("version"),
                "cluster_id": data.get("cluster_id"),
                "node_id": data.get("node_id"),
                "lb_status": data.get("lb_status"),
            }

    async def search_logs(
        self,
        nas_ip: str | None,
        since: datetime,
        until: datetime | None = None,
        username: str | None = None,
        limit: int = 200,
        nas_identifier: str | None = None,
    ) -> list[dict[str, Any]]:
        nas_parts: list[str] = []
        if nas_ip:
            nas_parts.append(f'{self.nas_ip_field}:"{nas_ip}"')
        if nas_identifier:
            safe_id = nas_identifier.replace('"', '\\"')
            nas_parts.append(f'message:"*{safe_id}*"')
        if not nas_parts:
            raise ValueError("Either nas_ip or nas_identifier must be provided")
        parts = [f"({' OR '.join(nas_parts)})"] if len(nas_parts) > 1 else [nas_parts[0]]

        if username:
            if self.username_field:
                parts.append(f'{self.username_field}:"{username}"')
            else:
                parts.append(f'message:"*{username}*"')
        if self.stream_id:
            parts.append(f"streams:{self.stream_id}")

        to_dt = until or datetime.now(tz=timezone.utc)
        fmt = "%Y-%m-%d %H:%M:%S"
        params: dict[str, Any] = {
            "query": " AND ".join(parts),
            "from": since.astimezone(timezone.utc).strftime(fmt),
            "to": to_dt.astimezone(timezone.utc).strftime(fmt),
            "limit": limit,
            "sort": "timestamp:asc",
            "decorate": "false",
        }
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as c:
            r = await c.get(
                f"{self.base_url}/api/search/universal/absolute",
                auth=self.auth,
                headers=self._headers,
                params=params,
            )
            r.raise_for_status()
            data = r.json()
            result: list[dict[str, Any]] = []
            for item in data.get("messages", []):
                msg = item.get("message", {})
                result.append(
                    {
                        "timestamp": msg.get("timestamp", ""),
                        "message": msg.get("message", ""),
                        "source": msg.get("source", ""),
                        "level": msg.get("level"),
                        "fields": {
                            k: v
                            for k, v in msg.items()
                            if k not in _SKIP_FIELDS | {"timestamp", "message", "source", "level"}
                        },
                    }
                )
            return result
