from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "b6f2d8a3e91c"
down_revision = "a9d4e7f2c1b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_vpn_tunnel",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(15), nullable=False, unique=True),
        sa.Column("type", sa.String(16), nullable=False, server_default="wireguard"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("description", sa.String(120), nullable=True),
        sa.Column("routes", sa.Text(), nullable=False, server_default=""),
        sa.Column("wg_private_key", sa.Text(), nullable=True),
        sa.Column("wg_public_key", sa.Text(), nullable=True),
        sa.Column("wg_address", sa.Text(), nullable=True),
        sa.Column("wg_listen_port", sa.Integer(), nullable=True),
        sa.Column("wg_peer_public_key", sa.Text(), nullable=True),
        sa.Column("wg_peer_host", sa.Text(), nullable=True),
        sa.Column("wg_peer_port", sa.Integer(), nullable=True, server_default="51820"),
        sa.Column("wg_persistent_keepalive", sa.Integer(), nullable=True),
        sa.Column("wg_mtu", sa.Integer(), nullable=True),
        sa.Column("wg_dns", sa.Text(), nullable=True),
        sa.Column("l2tp_gateway", sa.Text(), nullable=True),
        sa.Column("l2tp_psk", sa.Text(), nullable=True),
        sa.Column("l2tp_username", sa.Text(), nullable=True),
        sa.Column("l2tp_password", sa.Text(), nullable=True),
        sa.Column("oper_state", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("iface", sa.String(32), nullable=True),
        sa.Column("rx_bytes", sa.BigInteger(), nullable=True),
        sa.Column("tx_bytes", sa.BigInteger(), nullable=True),
        sa.Column("last_handshake_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_status_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("mr_vpn_tunnel")
