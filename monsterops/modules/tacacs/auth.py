
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.auth.utils import verify_password
from monsterops.modules.realms import ldap_probe
from monsterops.modules.realms.models import MrIdentitySource
from monsterops.modules.tacacs.models import MrTacacsUser

logger = logging.getLogger(__name__)

LOCAL_PASSWORD = "local_password"
DIRECTORY_DELEGATED = "directory_delegated"


async def verify_credentials(db: AsyncSession, username: str, password: str) -> MrTacacsUser | None:
    user = await db.scalar(select(MrTacacsUser).where(MrTacacsUser.username == username))
    if user is None or not user.enabled:
        return None

    if user.auth_method == LOCAL_PASSWORD:
        if user.password_hash and verify_password(password, user.password_hash):
            return user
        return None

    if user.auth_method == DIRECTORY_DELEGATED:
        if await _verify_directory(db, user, username, password):
            return user
        return None

    logger.warning("TACACS+: unknown auth_method %r for %s", user.auth_method, username)
    return None


async def _verify_directory(
    db: AsyncSession, user: MrTacacsUser, username: str, password: str
) -> bool:
    if not user.identity_source_id or not password:
        return False
    src = await db.get(MrIdentitySource, user.identity_source_id)
    if src is None:
        return False
    principal = bind_principal(src, username)
    return await asyncio.to_thread(_ldap_bind_ok, src, principal, password)


def bind_principal(src: MrIdentitySource, username: str) -> str:
    if "@" in username or "\\" in username:
        return username
    parts = [
        p.split("=", 1)[1]
        for p in (src.base_dn or "").split(",")
        if p.strip().lower().startswith("dc=")
    ]
    domain = ".".join(parts)
    return f"{username}@{domain}" if domain else username


def _ldap_bind_ok(src: MrIdentitySource, principal: str, password: str) -> bool:
    try:
        conn = ldap_probe.connect(
            host=src.host,
            port=src.port,
            encryption=src.encryption,
            bind_dn=principal,
            bind_password=password,
            tls_verify=src.tls_verify,
            timeout=src.timeout,
        )
        try:
            conn.unbind()
        except Exception:
            pass
        return True
    except ldap_probe.LdapBindError:
        return False
    except Exception as exc:
        logger.warning("TACACS+: directory bind error for %s: %s", principal, exc)
        return False
