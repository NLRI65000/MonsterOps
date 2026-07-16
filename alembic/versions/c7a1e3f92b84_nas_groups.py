
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c7a1e3f92b84"
down_revision = "fd99a6deb43d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_nas_group",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.String(200), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_mr_nas_group_name"),
    )
    op.create_table(
        "mr_nas_group_member",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nas_group_id", sa.Integer(), nullable=False),
        sa.Column("nas_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["nas_group_id"], ["mr_nas_group.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nas_group_id", "nas_id", name="uq_mr_nas_group_member"),
    )
    op.create_table(
        "mr_radius_group_nas_group",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("radius_groupname", sa.String(64), nullable=False),
        sa.Column("nas_group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["nas_group_id"], ["mr_nas_group.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "radius_groupname", "nas_group_id", name="uq_mr_radius_group_nas_group"
        ),
    )


def downgrade() -> None:
    op.drop_table("mr_radius_group_nas_group")
    op.drop_table("mr_nas_group_member")
    op.drop_table("mr_nas_group")
