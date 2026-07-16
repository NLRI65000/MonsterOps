
from __future__ import annotations

from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

LOCAL_PASSWORD = "local_password"
DIRECTORY_DELEGATED = "directory_delegated"
AUTH_METHODS = (LOCAL_PASSWORD, DIRECTORY_DELEGATED)

PAP, CHAP, MSCHAP, EAP = "pap", "chap", "mschap", "eap"


@runtime_checkable
class EnforcementAdapter(Protocol):

    async def username_exists(self, db: AsyncSession, username: str) -> bool:
        ...

    async def is_enabled(self, db: AsyncSession, username: str) -> bool:
        ...

    async def materialize(
        self, db: AsyncSession, *, username: str, auth_method: str, enabled: bool
    ) -> None:
        ...

    async def set_entitlements(
        self, db: AsyncSession, username: str, groupname: str | None
    ) -> None:
        ...

    async def rename(self, db: AsyncSession, old: str, new: str) -> None:
        ...

    async def deprovision(self, db: AsyncSession, username: str, action: str) -> None:
        ...

    def capabilities(self, source_type: str | None, auth_method: str) -> set[str]:
        ...

    def server_requirements(self, auth_method: str) -> list[str]:
        ...

    def host_delegation_status(self) -> dict:
        ...
