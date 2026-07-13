from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "d4b2f6c81e93"
down_revision = "c3f1a8e20d74"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mr_nas_manager",
                  sa.Column("history_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("mr_nas_manager",
                  sa.Column("fetch_interval_hours", sa.Integer(), nullable=False, server_default="24"))
    op.add_column("mr_nas_manager",
                  sa.Column("retention_days", sa.Integer(), nullable=True))
    op.add_column("mr_nas_manager",
                  sa.Column("last_fetch_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "mr_nas_config_version",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("manager_id", sa.Integer(),
                  sa.ForeignKey("mr_nas_manager.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nas_id", sa.Integer(),
                  sa.ForeignKey("nas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("line_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_nas_config_version_nas_created",
                    "mr_nas_config_version", ["nas_id", "created_at"])


def downgrade() -> None:
    op.drop_table("mr_nas_config_version")
    op.drop_column("mr_nas_manager", "last_fetch_at")
    op.drop_column("mr_nas_manager", "retention_days")
    op.drop_column("mr_nas_manager", "fetch_interval_hours")
    op.drop_column("mr_nas_manager", "history_enabled")
