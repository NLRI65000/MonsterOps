
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a4d1c7e6b520"
down_revision = "f2a8c4d97b16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mr_firewall_config",
        sa.Column("autoblock_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "mr_firewall_config",
        sa.Column("autoblock_threshold", sa.Integer(), nullable=False, server_default="10"),
    )
    op.add_column(
        "mr_firewall_config",
        sa.Column("autoblock_window", sa.Integer(), nullable=False, server_default="10"),
    )
    op.add_column(
        "mr_firewall_config",
        sa.Column("autoblock_ban_seconds", sa.Integer(), nullable=False, server_default="3600"),
    )


def downgrade() -> None:
    op.drop_column("mr_firewall_config", "autoblock_ban_seconds")
    op.drop_column("mr_firewall_config", "autoblock_window")
    op.drop_column("mr_firewall_config", "autoblock_threshold")
    op.drop_column("mr_firewall_config", "autoblock_enabled")
