from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c3f1a8e20d74"
down_revision = "b6f2d8a3e91c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_nas_manager",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nas_id", sa.Integer(), sa.ForeignKey("nas.id", ondelete="CASCADE"),
                  unique=True, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("conn_type", sa.String(10), nullable=False, server_default="ssh"),
        sa.Column("netmiko_device_type", sa.String(64), nullable=False),
        sa.Column("host", sa.String(253), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("secret_enc", sa.Text(), nullable=False),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test_status", sa.String(16), nullable=True),
        sa.Column("test_error", sa.Text(), nullable=True),
        sa.Column("raw_config", sa.Text(), nullable=True),
        sa.Column("config_pulled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("config_pushed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_dispatch_result", sa.Text(), nullable=True),
    )

    op.create_table(
        "mr_nas_dispatch_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nas_id", sa.Integer(), sa.ForeignKey("nas.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actor", sa.String(64), nullable=True),
    )
    op.create_index("ix_nas_dispatch_log_nas_id", "mr_nas_dispatch_log", ["nas_id"])


def downgrade() -> None:
    op.drop_table("mr_nas_dispatch_log")
    op.drop_table("mr_nas_manager")
