from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "e7c3a9d15f84"
down_revision = "d4b2f6c81e93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_firewall_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("managed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("default_input_policy", sa.String(8), nullable=False, server_default="drop"),
        sa.Column("default_forward_policy", sa.String(8), nullable=False, server_default="drop"),
        sa.Column("allow_ping", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("ssh_guard_port", sa.Integer(), nullable=False, server_default="22"),
        sa.Column("web_guard_port", sa.Integer(), nullable=False, server_default="8000"),
        sa.Column("confirm_timeout", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("last_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "mr_firewall_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("chain", sa.String(8), nullable=False, server_default="input"),
        sa.Column("action", sa.String(8), nullable=False, server_default="accept"),
        sa.Column("protocol", sa.String(8), nullable=True),
        sa.Column("saddr", sa.String(64), nullable=True),
        sa.Column("daddr", sa.String(64), nullable=True),
        sa.Column("sport", sa.String(48), nullable=True),
        sa.Column("dport", sa.String(48), nullable=True),
        sa.Column("iifname", sa.String(32), nullable=True),
        sa.Column("oifname", sa.String(32), nullable=True),
        sa.Column("ct_state", sa.String(48), nullable=True),
        sa.Column("src_set", sa.String(48), nullable=True),
        sa.Column("comment", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_firewall_rule_position", "mr_firewall_rule", ["position"])

    op.create_table(
        "mr_firewall_set",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(48), nullable=False, unique=True),
        sa.Column("family", sa.String(12), nullable=False, server_default="ipv4_addr"),
        sa.Column("kind", sa.String(12), nullable=False, server_default="block"),
        sa.Column("auto_ban", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("comment", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "mr_firewall_set_entry",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("set_id", sa.Integer(),
                  sa.ForeignKey("mr_firewall_set.id", ondelete="CASCADE"), nullable=False),
        sa.Column("element", sa.String(64), nullable=False),
        sa.Column("comment", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_firewall_set_entry_set", "mr_firewall_set_entry", ["set_id"])

    op.create_table(
        "mr_firewall_snapshot",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nft_text", sa.Text(), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("actor", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("mr_firewall_snapshot")
    op.drop_table("mr_firewall_set_entry")
    op.drop_table("mr_firewall_set")
    op.drop_table("mr_firewall_rule")
    op.drop_table("mr_firewall_config")
