
from __future__ import annotations

from alembic import op

revision = "c1f7b4a9d2e6"
down_revision = "b8e3f1a2d9c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_radacct_keyset",
            "radacct",
            ["acctstarttime", "radacctid"],
            postgresql_concurrently=True,
            if_not_exists=True,
        )
        op.create_index(
            "ix_radpostauth_keyset",
            "radpostauth",
            ["authdate", "id"],
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_radpostauth_keyset",
            table_name="radpostauth",
            postgresql_concurrently=True,
            if_exists=True,
        )
        op.drop_index(
            "ix_radacct_keyset", table_name="radacct", postgresql_concurrently=True, if_exists=True
        )
