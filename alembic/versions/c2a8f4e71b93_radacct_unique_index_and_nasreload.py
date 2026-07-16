
from __future__ import annotations

from alembic import op

revision = "c2a8f4e71b93"
down_revision = "b7d3f1e92a05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS radacct_acctuniqueid
        ON radacct (acctuniqueid)
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS nasreload (
            nasipaddress inet PRIMARY KEY,
            reloadtime   timestamp with time zone NOT NULL
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS nasreload")
    op.execute("DROP INDEX IF EXISTS radacct_acctuniqueid")
