
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "e5c9a1f3d827"
down_revision = "d3b7f0a15c92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_identity_source",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "source_type", sa.String(length=24), nullable=False, server_default="active_directory"
        ),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="389"),
        sa.Column("encryption", sa.String(length=10), nullable=False, server_default="none"),
        sa.Column("base_dn", sa.Text(), nullable=False),
        sa.Column("bind_dn", sa.Text(), nullable=True),
        sa.Column("bind_password_enc", sa.Text(), nullable=True),
        sa.Column("tls_verify", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("timeout", sa.Integer(), nullable=False, server_default="10"),
        sa.Column(
            "login_attribute",
            sa.String(length=64),
            nullable=False,
            server_default="userPrincipalName",
        ),
        sa.Column("strip_login_suffix", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("user_search_base", sa.Text(), nullable=True),
        sa.Column(
            "user_search_filter",
            sa.Text(),
            nullable=False,
            server_default="(&(objectCategory=person)(objectClass=user))",
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="unknown"),
        sa.Column("last_rtt_ms", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_probe_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("name", name="uq_mr_identity_source_name"),
    )

    op.create_table(
        "mr_auth_domain",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("identity_source_id", sa.Integer(), nullable=True),
        sa.Column(
            "auth_method", sa.String(length=24), nullable=False, server_default="local_password"
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("default_groupname", sa.Text(), nullable=True),
        sa.Column(
            "deprovision_action", sa.String(length=8), nullable=False, server_default="disable"
        ),
        sa.Column("ad_short_domain", sa.String(length=64), nullable=True),
        sa.Column("import_mode", sa.String(length=8), nullable=False, server_default="all"),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sync_interval_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(length=16), nullable=True),
        sa.Column("last_sync_stats", JSONB(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["identity_source_id"], ["mr_identity_source.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint("name", name="uq_mr_auth_domain_name"),
    )

    op.create_table(
        "mr_auth_group_map",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auth_domain_id", sa.Integer(), nullable=False),
        sa.Column("ad_group", sa.Text(), nullable=False),
        sa.Column("groupname", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["auth_domain_id"], ["mr_auth_domain.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("auth_domain_id", "ad_group", name="uq_auth_group_map"),
    )

    op.create_table(
        "mr_auth_synced_user",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auth_domain_id", sa.Integer(), nullable=False),
        sa.Column("ad_object_guid", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("ad_dn", sa.Text(), nullable=True),
        sa.Column("ad_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("groupname", sa.Text(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["auth_domain_id"], ["mr_auth_domain.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("ad_object_guid", name="uq_mr_auth_synced_user_guid"),
    )
    op.create_index("ix_mr_auth_synced_user_domain", "mr_auth_synced_user", ["auth_domain_id"])
    op.create_index("ix_mr_auth_synced_user_username", "mr_auth_synced_user", ["username"])

    op.create_table(
        "mr_auth_domain_nas_group",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auth_domain_id", sa.Integer(), nullable=False),
        sa.Column("nas_group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["auth_domain_id"], ["mr_auth_domain.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["nas_group_id"], ["mr_nas_group.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("auth_domain_id", "nas_group_id", name="uq_auth_domain_nas_group"),
    )


def downgrade() -> None:
    op.drop_table("mr_auth_domain_nas_group")
    op.drop_index("ix_mr_auth_synced_user_username", table_name="mr_auth_synced_user")
    op.drop_index("ix_mr_auth_synced_user_domain", table_name="mr_auth_synced_user")
    op.drop_table("mr_auth_synced_user")
    op.drop_table("mr_auth_group_map")
    op.drop_table("mr_auth_domain")
    op.drop_table("mr_identity_source")
