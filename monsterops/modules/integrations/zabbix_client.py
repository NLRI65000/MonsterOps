from __future__ import annotations

from typing import Any

import httpx

_SEVERITY = {
    "0": "Not classified",
    "1": "Information",
    "2": "Warning",
    "3": "Average",
    "4": "High",
    "5": "Disaster",
}
_SEVERITY_COLOR = {
    "0": "muted",
    "1": "info",
    "2": "warning",
    "3": "warning",
    "4": "danger",
    "5": "danger",
}


class ZabbixClient:
    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        verify_ssl: bool = False,
        timeout: int = 10,
    ) -> None:
        url = base_url.rstrip("/")
        self.url = url if url.endswith("api_jsonrpc.php") else f"{url}/api_jsonrpc.php"
        self.username = username
        self.password = password
        self.verify = verify_ssl
        self.timeout = timeout
        self._req = 0

    def _next_id(self) -> int:
        self._req += 1
        return self._req

    def _parse_use_header(self, version_str: str) -> bool:
        parts = str(version_str).split(".")
        try:
            major = int(parts[0])
            minor = int(parts[1]) if len(parts) > 1 else 0
        except (ValueError, IndexError):
            return False
        return (major, minor) >= (6, 4)

    async def _rpc(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: dict[str, Any],
        auth_token: str | None = None,
        use_header: bool = False,
    ) -> Any:
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self._next_id(),
        }
        headers: dict[str, str] = {}
        if auth_token:
            if use_header:
                headers["Authorization"] = f"Bearer {auth_token}"
            else:
                payload["auth"] = auth_token
        r = await client.post(self.url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            err = data["error"]
            raise RuntimeError(err.get("data") or err.get("message", "Zabbix RPC error"))
        return data["result"]

    async def _login(self, client: httpx.AsyncClient) -> tuple[str, bool]:
        version_str = str(await self._rpc(client, "apiinfo.version", {}))
        use_header = self._parse_use_header(version_str)
        try:
            token = await self._rpc(
                client, "user.login", {"username": self.username, "password": self.password}
            )
        except RuntimeError:
            token = await self._rpc(
                client, "user.login", {"user": self.username, "password": self.password}
            )
        return str(token), use_header

    async def test_connection(self) -> dict[str, Any]:
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as c:
            version_str = str(await self._rpc(c, "apiinfo.version", {}))
            try:
                token = await self._rpc(
                    c, "user.login", {"username": self.username, "password": self.password}
                )
            except RuntimeError:
                token = await self._rpc(
                    c, "user.login", {"user": self.username, "password": self.password}
                )
            return {"version": version_str, "authenticated": bool(token)}

    async def get_host_problems(self, nas_ip: str) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as c:
            token, use_header = await self._login(c)

            ifaces = await self._rpc(
                c,
                "hostinterface.get",
                {"output": ["hostid", "ip"], "filter": {"ip": nas_ip}},
                auth_token=token,
                use_header=use_header,
            )
            if not ifaces:
                return []

            host_ids = list({i["hostid"] for i in ifaces})
            hosts = await self._rpc(
                c,
                "host.get",
                {"output": ["hostid", "host", "name"], "hostids": host_ids},
                auth_token=token,
                use_header=use_header,
            )
            host_map: dict[str, str] = {
                h["hostid"]: (h.get("name") or h.get("host", "")) for h in hosts
            }

            problems = await self._rpc(
                c,
                "problem.get",
                {
                    "output": "extend",
                    "hostids": host_ids,
                    "recent": False,
                    "sortfield": "eventid",
                    "sortorder": "DESC",
                    "limit": 100,
                },
                auth_token=token,
                use_header=use_header,
            )

            return [
                {
                    "eventid": p.get("eventid"),
                    "name": p.get("name"),
                    "severity": _SEVERITY.get(str(p.get("severity", 0)), "Unknown"),
                    "severity_level": int(p.get("severity", 0)),
                    "color": _SEVERITY_COLOR.get(str(p.get("severity", 0)), "muted"),
                    "clock": int(p.get("clock", 0)),
                    "acknowledged": bool(int(p.get("acknowledged", 0))),
                    "hostname": host_map.get(p.get("objectid", ""), ""),
                }
                for p in problems
            ]

    async def get_problems_summary(self) -> dict[str, Any]:
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as c:
            token, use_header = await self._login(c)
            problems = await self._rpc(
                c,
                "problem.get",
                {"output": ["severity", "acknowledged"], "recent": False, "limit": 1000},
                auth_token=token,
                use_header=use_header,
            )
            by_sev: dict[str, int] = {}
            for p in problems:
                label = _SEVERITY.get(str(p.get("severity", 0)), "Unknown")
                by_sev[label] = by_sev.get(label, 0) + 1
            return {"total": len(problems), "by_severity": by_sev}
