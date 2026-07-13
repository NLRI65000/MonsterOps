from __future__ import annotations

import os

_base_url = os.environ.get(
    "MONSTEROPS_DATABASE_URL",
    "postgresql+asyncpg://radius:radius@localhost/radius",
)
_test_url = _base_url.rsplit("/", 1)[0] + "/radius_test"
os.environ["MONSTEROPS_DATABASE_URL"] = _test_url
os.environ.setdefault("MONSTEROPS_SECRET_KEY", "test-secret-for-ci-only-32bytes!")

import asyncpg  # noqa: E402
import pytest_asyncio  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from monsterops.database import Base, engine  # noqa: E402

import monsterops.limiter as _mr_limiter  # noqa: E402
_mr_limiter.limiter.enabled = False

from monsterops.modules.accounting.models import Nasreload, Radacct  # noqa: E402, F401
from monsterops.modules.apikeys.models import ApiKey  # noqa: E402, F401
from monsterops.modules.auth.models import AdminUser, AuditLog  # noqa: E402, F401
from monsterops.modules.auth_logs.models import Radpostauth  # noqa: E402, F401
from monsterops.modules.groups.models import GroupAccessType, Radgroupcheck, Radgroupreply  # noqa: E402, F401
from monsterops.modules.integrations.models import Integration  # noqa: E402, F401
from monsterops.modules.ip_pools.models import Radippool  # noqa: E402, F401
from monsterops.modules.nas.models import Nas, NasGroup, NasGroupMember, RadiusGroupNasGroup  # noqa: E402, F401
from monsterops.modules.notifications.models import NotificationChannel, NotificationHistory, NotificationRule  # noqa: E402, F401
from monsterops.modules.realms.models import HomeServer, HomeServerPool, HomeServerPoolMember, NasGroupRealm, Realm  # noqa: E402, F401
from monsterops.modules.scheduler.models import ReportRun, SchedulerJob  # noqa: E402, F401
from monsterops.modules.users.models import Radcheck, Radreply, Radusergroup  # noqa: E402, F401
from monsterops.modules.vpn.models import VpnTunnel  # noqa: E402, F401

from monsterops.app import create_app  # noqa: E402

_ph = PasswordHasher()
_asyncpg_prefix = "postgresql+asyncpg://"
_pg_base = _base_url[len(_asyncpg_prefix):] if _base_url.startswith(_asyncpg_prefix) else _base_url.split("://", 1)[1]
_pg_authority = _pg_base.rsplit("/", 1)[0]
_MAINTENANCE_DBS = [
    f"postgresql://{_pg_authority}/radius",
    f"postgresql://{_pg_authority}/postgres",
]
_TEST_DB = "radius_test"

_SessionTest = async_sessionmaker(engine, expire_on_commit=False)


async def _ensure_test_db() -> None:
    last_exc: Exception | None = None
    for connstr in _MAINTENANCE_DBS:
        try:
            conn = await asyncpg.connect(connstr)
            try:
                await conn.execute(f'CREATE DATABASE "{_TEST_DB}"')
                return
            except asyncpg.exceptions.DuplicateDatabaseError:
                return
            except (
                asyncpg.exceptions.InsufficientPrivilegeError,
                asyncpg.exceptions.ObjectInUseError,
            ) as exc:
                last_exc = exc
            finally:
                await conn.close()
        except Exception as exc:
            last_exc = exc
    if last_exc:
        import logging
        logging.getLogger(__name__).warning(
            "Could not create test DB %r: %s — assuming it already exists.",
            _TEST_DB, last_exc,
        )



@pytest_asyncio.fixture(scope="session")
async def db_setup():
    await _ensure_test_db()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()



@pytest_asyncio.fixture(scope="session")
async def _superadmin(db_setup):
    async with _SessionTest() as session:
        for username, role, email in [
            ("testadmin", "superadmin", "testadmin@test.local"),
            ("testadmin_admin", "admin", "testadmin_admin@test.local"),
            ("testadmin_ro", "readonly", "testadmin_ro@test.local"),
        ]:
            existing = await session.scalar(select(AdminUser).where(AdminUser.username == username))
            if not existing:
                session.add(AdminUser(
                    username=username,
                    email=email,
                    hashed_password=_ph.hash("Test1234!"),
                    role=role,
                    is_active=True,
                ))
        await session.commit()



async def _login(client: AsyncClient, username: str, password: str) -> str:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"Login as {username!r} failed ({r.status_code}): {r.text}"
    token = r.cookies.get("mr_access")
    assert token, "login did not set the mr_access cookie"
    client.cookies.clear()
    return token



@pytest_asyncio.fixture(scope="session")
async def client(_superadmin):
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(scope="session")
async def superadmin_client(_superadmin):
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _login(c, "testadmin", "Test1234!")
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


@pytest_asyncio.fixture(scope="session")
async def admin_client(_superadmin):
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _login(c, "testadmin_admin", "Test1234!")
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


@pytest_asyncio.fixture(scope="session")
async def readonly_client(_superadmin):
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _login(c, "testadmin_ro", "Test1234!")
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c
