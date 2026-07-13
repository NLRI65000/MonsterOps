from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d3b7f0a15c92"
down_revision = "c1f7b4a9d2e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_firewall_block_event",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("element", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="brute_force"),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("set_name", sa.String(length=48), nullable=False),
        sa.Column("ban_seconds", sa.Integer(), nullable=True),
        sa.Column("override_by", sa.String(length=64), nullable=True),
        sa.Column("override_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_mr_firewall_block_event_created_at",
        "mr_firewall_block_event", ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_mr_firewall_block_event_created_at",
                  table_name="mr_firewall_block_event")
    op.drop_table("mr_firewall_block_event")
