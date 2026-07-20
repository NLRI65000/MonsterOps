
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b7f2c9a4e1d3"
down_revision = "e5c9a1f3d827"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_nas_reachability",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "nas_id",
            sa.Integer(),
            sa.ForeignKey("nas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("method", sa.String(8), nullable=False, server_default="icmp"),
        sa.Column("last_rtt_ms", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_probe_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
    )
    op.create_unique_constraint("uq_mr_nas_reachability_nas_id", "mr_nas_reachability", ["nas_id"])


def downgrade() -> None:
    op.drop_table("mr_nas_reachability")
