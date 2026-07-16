
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e3a7f1c90d52"
down_revision = "f4c8d2a91b37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_access_types",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("groupname", sa.Text(), nullable=False),
        sa.Column("login_type", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("groupname", "login_type", name="uq_group_login_type"),
    )
    op.create_index("ix_group_access_types_groupname", "group_access_types", ["groupname"])


def downgrade() -> None:
    op.drop_index("ix_group_access_types_groupname", table_name="group_access_types")
    op.drop_table("group_access_types")
