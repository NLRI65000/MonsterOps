from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "a9d4e7f2c1b5"
down_revision = "f3a7c1e2d9b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_home_server",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("auth_port", sa.Integer(), nullable=False, server_default="1812"),
        sa.Column("acct_port", sa.Integer(), nullable=False, server_default="1813"),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("type", sa.String(8), nullable=False, server_default="auth"),
        sa.Column("response_window", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("zombie_period", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("revive_interval", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("vpn_interface", sa.String(32), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("last_rtt_ms", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_probe_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "mr_home_server_pool",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("pool_type", sa.String(24), nullable=False, server_default="fail-over"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "mr_home_server_pool_member",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("pool_id", sa.Integer(), sa.ForeignKey("mr_home_server_pool.id", ondelete="CASCADE"), nullable=False),
        sa.Column("server_id", sa.Integer(), sa.ForeignKey("mr_home_server.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("pool_id", "server_id", name="uq_pool_server"),
    )

    op.create_table(
        "mr_realm",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("pool_id", sa.Integer(), sa.ForeignKey("mr_home_server_pool.id", ondelete="SET NULL"), nullable=True),
        sa.Column("strip_username", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "mr_nas_group_realm",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("nas_group_id", sa.Integer(), sa.ForeignKey("mr_nas_group.id", ondelete="CASCADE"), nullable=False),
        sa.Column("realm_id", sa.Integer(), sa.ForeignKey("mr_realm.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("nas_group_id", "realm_id", name="uq_nasgroup_realm"),
    )


def downgrade() -> None:
    op.drop_table("mr_nas_group_realm")
    op.drop_table("mr_realm")
    op.drop_table("mr_home_server_pool_member")
    op.drop_table("mr_home_server_pool")
    op.drop_table("mr_home_server")
