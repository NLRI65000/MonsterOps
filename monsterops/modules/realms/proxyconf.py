"""Generate /etc/freeradius/3.0/proxy.conf from DB state (22.7).

All interpolated values are validated at the API boundary (schemas.py) AND
re-checked here as defence in depth — a value that could close a stanza or
start a new directive must never reach the file.
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.realms.models import (
    HomeServer,
    HomeServerPool,
    HomeServerPoolMember,
    Realm,
)

_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:_-]*$")

HEADER = """\
# proxy.conf — managed by MonsterOps (Phase 22)
# Do not edit by hand: changes are overwritten on every apply.
# Generated from the Realms module (home servers, pools, realms).

proxy server {
\tdefault_fallback = no
}
"""


def _token(value: str, what: str) -> str:
    if not _SAFE_TOKEN.match(value):
        raise ValueError(f"unsafe {what} for proxy.conf: {value!r}")
    return value


def _quoted(value: str, what: str) -> str:
    if '"' in value or "\\" in value or any(ord(c) < 0x20 for c in value):
        raise ValueError(f"unsafe {what} for proxy.conf")
    return f'"{value}"'


def _home_server_stanza(s: HomeServer, kind: str, name: str, port: int) -> str:
    return (
        f"home_server {_token(name, 'server name')} {{\n"
        f"\ttype = {kind}\n"
        f"\tipaddr = {_token(s.host, 'host')}\n"
        f"\tport = {int(port)}\n"
        f"\tsecret = {_quoted(s.secret, 'secret')}\n"
        f"\tresponse_window = {int(s.response_window)}\n"
        f"\tzombie_period = {int(s.zombie_period)}\n"
        f"\trevive_interval = {int(s.revive_interval)}\n"
        f"\tstatus_check = status-server\n"
        f"}}\n"
    )


def _server_stanza_names(s: HomeServer) -> dict[str, str]:
    """Names of the emitted stanzas per traffic kind for this server."""
    if s.type == "both":
        return {"auth": f"{s.name}-auth", "acct": f"{s.name}-acct"}
    return {s.type: s.name}


async def generate_proxy_conf(db: AsyncSession) -> str:
    servers = (await db.execute(select(HomeServer).order_by(HomeServer.name))).scalars().all()
    pools = (await db.execute(select(HomeServerPool).order_by(HomeServerPool.name))).scalars().all()
    members = (
        await db.execute(
            select(HomeServerPoolMember).order_by(
                HomeServerPoolMember.pool_id, HomeServerPoolMember.position
            )
        )
    ).scalars().all()
    realms = (await db.execute(select(Realm).order_by(Realm.name))).scalars().all()

    by_id = {s.id: s for s in servers}
    pool_members: dict[int, list[HomeServer]] = {}
    for m in members:
        srv = by_id.get(m.server_id)
        if srv:
            pool_members.setdefault(m.pool_id, []).append(srv)

    parts: list[str] = [HEADER]

    for s in servers:
        names = _server_stanza_names(s)
        if "auth" in names:
            parts.append(_home_server_stanza(s, "auth", names["auth"], s.auth_port))
        if "acct" in names:
            parts.append(_home_server_stanza(s, "acct", names["acct"], s.acct_port))

    pool_kind_names: dict[int, dict[str, str]] = {}
    for p in pools:
        pid = int(p.id)
        srvs = pool_members.get(pid, [])
        kinds: dict[str, list[str]] = {}
        for s in srvs:
            for kind, stanza_name in _server_stanza_names(s).items():
                kinds.setdefault(kind, []).append(stanza_name)
        pool_kind_names[pid] = {}
        for kind, stanza_names in kinds.items():
            pool_name = p.name if len(kinds) == 1 else f"{p.name}-{kind}"
            pool_kind_names[pid][kind] = pool_name
            lines = [f"home_server_pool {_token(pool_name, 'pool name')} {{"]
            lines.append(f"\ttype = {_token(p.pool_type, 'pool type')}")
            for n in stanza_names:
                lines.append(f"\thome_server = {_token(n, 'server name')}")
            lines.append("}\n")
            parts.append("\n".join(lines))

    for r in realms:
        lines = [f"realm {_token(r.name, 'realm name')} {{"]
        kind_names = pool_kind_names.get(r.pool_id or -1, {})
        if "auth" in kind_names:
            lines.append(f"\tauth_pool = {kind_names['auth']}")
        if "acct" in kind_names:
            lines.append(f"\tacct_pool = {kind_names['acct']}")
        if not r.strip_username:
            lines.append("\tnostrip")
        lines.append("}\n")
        parts.append("\n".join(lines))

    return "\n".join(parts)
