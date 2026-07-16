from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

import monsterops.modules.accounting.models  # noqa: F401
import monsterops.modules.apikeys.models  # noqa: F401

import monsterops.modules.auth.models  # noqa: F401
import monsterops.modules.auth_logs.models  # noqa: F401
import monsterops.modules.automation.models  # noqa: F401
import monsterops.modules.groups.models  # noqa: F401
import monsterops.modules.integrations.models  # noqa: F401
import monsterops.modules.ip_pools.models  # noqa: F401
import monsterops.modules.nas.models  # noqa: F401
import monsterops.modules.notifications.models  # noqa: F401
import monsterops.modules.scheduler.models  # noqa: F401
import monsterops.modules.users.models  # noqa: F401
import monsterops.modules.webhooks.models  # noqa: F401
from alembic import context
from monsterops.config import settings
from monsterops.database import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


_SKIP_INDEXES = {"radacct_calss_idx", "radpostauth_class_idx"}


def _include_object(obj, name, type_, reflected, compare_to):
    if type_ == "index" and name in _SKIP_INDEXES:
        return False
    return True


def do_run_migrations(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
