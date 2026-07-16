
from __future__ import annotations

import secrets
import shutil
import subprocess
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.realms.enforcement.base import (
    CHAP,
    DIRECTORY_DELEGATED,
    EAP,
    LOCAL_PASSWORD,
    MSCHAP,
    PAP,
)
from monsterops.modules.users.models import Radcheck, Radusergroup

_PWD_ATTR = "Cleartext-Password"
_AUTHTYPE_ATTR = "Auth-Type"
_REJECT = "Reject"
_NTLM_AUTH_TYPE = "NTLM-Auth"

_PWD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def _gen_password(length: int = 14) -> str:
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(length))


class FreeRadiusAdapter:

    async def username_exists(self, db: AsyncSession, username: str) -> bool:
        return bool(
            await db.scalar(select(Radcheck.id).where(Radcheck.username == username).limit(1))
        )

    async def _authtype(self, db: AsyncSession, username: str) -> str | None:
        return await db.scalar(
            select(Radcheck.value)
            .where(Radcheck.username == username, Radcheck.attribute == _AUTHTYPE_ATTR)
            .limit(1)
        )

    async def is_enabled(self, db: AsyncSession, username: str) -> bool:
        return (await self._authtype(db, username)) != _REJECT

    async def _has_password(self, db: AsyncSession, username: str) -> bool:
        return bool(
            await db.scalar(
                select(Radcheck.id)
                .where(Radcheck.username == username, Radcheck.attribute == _PWD_ATTR)
                .limit(1)
            )
        )

    async def _clear_authtype(self, db: AsyncSession, username: str) -> None:
        await db.execute(
            delete(Radcheck).where(
                Radcheck.username == username, Radcheck.attribute == _AUTHTYPE_ATTR
            )
        )

    async def _set_authtype(self, db: AsyncSession, username: str, value: str) -> None:
        await self._clear_authtype(db, username)
        db.add(Radcheck(username=username, attribute=_AUTHTYPE_ATTR, op=":=", value=value))

    async def _clear_password(self, db: AsyncSession, username: str) -> None:
        await db.execute(
            delete(Radcheck).where(Radcheck.username == username, Radcheck.attribute == _PWD_ATTR)
        )

    async def materialize(
        self, db: AsyncSession, *, username: str, auth_method: str, enabled: bool
    ) -> None:
        if auth_method == LOCAL_PASSWORD:
            if not await self._has_password(db, username):
                db.add(
                    Radcheck(username=username, attribute=_PWD_ATTR, op=":=", value=_gen_password())
                )
            if enabled:
                await self._clear_authtype(db, username)
            else:
                await self._set_authtype(db, username, _REJECT)
        elif auth_method == DIRECTORY_DELEGATED:
            await self._clear_password(db, username)
            await self._set_authtype(db, username, _NTLM_AUTH_TYPE if enabled else _REJECT)
        else:
            raise ValueError(f"unknown auth_method: {auth_method!r}")

    async def set_entitlements(
        self, db: AsyncSession, username: str, groupname: str | None
    ) -> None:
        await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
        if groupname:
            db.add(Radusergroup(username=username, groupname=groupname, priority=1))

    async def rename(self, db: AsyncSession, old: str, new: str) -> None:
        await db.execute(update(Radcheck).where(Radcheck.username == old).values(username=new))
        await db.execute(
            update(Radusergroup).where(Radusergroup.username == old).values(username=new)
        )

    async def deprovision(self, db: AsyncSession, username: str, action: str) -> None:
        if action == "delete":
            await db.execute(delete(Radcheck).where(Radcheck.username == username))
            await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
        else:
            await self._set_authtype(db, username, _REJECT)

    def capabilities(self, source_type: str | None, auth_method: str) -> set[str]:
        if auth_method == LOCAL_PASSWORD:
            return {PAP, CHAP, MSCHAP, EAP}
        if auth_method == DIRECTORY_DELEGATED:
            return {MSCHAP, PAP}
        return set()

    def server_requirements(self, auth_method: str) -> list[str]:
        if auth_method == DIRECTORY_DELEGATED:
            return [
                "Join the RADIUS host to the AD domain "
                "(deploy/provision-ad.sh: Samba/winbind + net ads join).",
                "A Domain Controller must be reachable at authentication time.",
            ]
        return []

    def host_delegation_status(self) -> dict:
        checks: list[dict] = []

        ntlm = shutil.which("ntlm_auth")
        checks.append(
            {
                "key": "ntlm_auth",
                "label": "ntlm_auth installed",
                "status": "ok" if ntlm else "fail",
                "detail": ntlm or "Samba/winbind not installed on this host.",
            }
        )

        from monsterops.config import settings

        fr_dir = Path(settings.freeradius_proxy_conf).parent
        module = fr_dir / "mods-enabled" / "mschap_ntlm"
        default_site = fr_dir / "sites-available" / "default"
        module_ok = module.exists()
        try:
            block_ok = "Auth-Type NTLM-Auth" in default_site.read_text(errors="ignore")
        except OSError:
            block_ok = False
        wiring_ok = module_ok and block_ok
        if not fr_dir.exists():
            wiring_status, wiring_detail = "unknown", f"FreeRADIUS config dir {fr_dir} not found."
        elif wiring_ok:
            wiring_status = "ok"
            wiring_detail = "mschap_ntlm module and Auth-Type NTLM-Auth block are installed."
        else:
            miss = []
            if not module_ok:
                miss.append("mschap_ntlm module")
            if not block_ok:
                miss.append("Auth-Type NTLM-Auth block")
            wiring_status, wiring_detail = "fail", "Missing: " + ", ".join(miss) + "."
        checks.append(
            {
                "key": "freeradius_wiring",
                "label": "FreeRADIUS NTLM-Auth wiring",
                "status": wiring_status,
                "detail": wiring_detail,
            }
        )

        wbinfo = shutil.which("wbinfo")
        if not wbinfo:
            trust_status, trust_detail = "fail", "wbinfo not installed (host not domain-joined)."
        else:
            try:
                r = subprocess.run([wbinfo, "-t"], capture_output=True, text=True, timeout=8)
                msg = (r.stdout or r.stderr).strip()
                if r.returncode == 0:
                    trust_status, trust_detail = "ok", msg or "Secure channel to the DC is healthy."
                elif any(w in msg.lower() for w in ("permission", "denied", "access")):
                    trust_status = "unknown"
                    trust_detail = (
                        "Winbind pipe not readable by the app user — the join may still be healthy."
                    )
                else:
                    trust_status, trust_detail = "fail", msg[:200] or "Trust check failed."
            except subprocess.TimeoutExpired:
                trust_status, trust_detail = "fail", "wbinfo -t timed out — winbind/DC unreachable."
            except OSError as e:
                trust_status, trust_detail = "unknown", str(e)
        checks.append(
            {
                "key": "winbind_trust",
                "label": "Winbind ↔ DC trust (wbinfo -t)",
                "status": trust_status,
                "detail": trust_detail,
            }
        )

        return {"ready": bool(ntlm) and wiring_ok, "checks": checks}


adapter: FreeRadiusAdapter = FreeRadiusAdapter()
