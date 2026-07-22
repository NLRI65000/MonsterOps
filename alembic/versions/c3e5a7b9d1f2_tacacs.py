
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c3e5a7b9d1f2"
down_revision = "a1c2e3f4b5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_tacacs_client",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("address", sa.String(64), nullable=False),
        sa.Column("secret_enc", sa.Text(), nullable=False),
        sa.Column(
            "nas_id", sa.Integer(), sa.ForeignKey("nas.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("single_connect", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_unique_constraint("uq_mr_tacacs_client_name", "mr_tacacs_client", ["name"])
    op.create_index("ix_mr_tacacs_client_address", "mr_tacacs_client", ["address"])

    op.create_table(
        "mr_tacacs_user",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column(
            "auth_method",
            sa.String(24),
            nullable=False,
            server_default=sa.text("'local_password'"),
        ),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column(
            "identity_source_id",
            sa.Integer(),
            sa.ForeignKey("mr_identity_source.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("privilege_level", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_unique_constraint("uq_mr_tacacs_user_username", "mr_tacacs_user", ["username"])
    op.create_index("ix_mr_tacacs_user_username", "mr_tacacs_user", ["username"])


def downgrade() -> None:
    op.drop_index("ix_mr_tacacs_user_username", table_name="mr_tacacs_user")
    op.drop_table("mr_tacacs_user")
    op.drop_index("ix_mr_tacacs_client_address", table_name="mr_tacacs_client")
    op.drop_table("mr_tacacs_client")
