
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a1c2e3f4b5d6"
down_revision = "b7f2c9a4e1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column(
            "totp_required",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.create_table(
        "mr_admin_totp",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("secret_enc", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("confirmed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_unique_constraint("uq_mr_admin_totp_admin_id", "mr_admin_totp", ["admin_id"])

    op.create_table(
        "mr_admin_recovery_code",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_mr_admin_recovery_code_admin_id", "mr_admin_recovery_code", ["admin_id"])


def downgrade() -> None:
    op.drop_index("ix_mr_admin_recovery_code_admin_id", table_name="mr_admin_recovery_code")
    op.drop_table("mr_admin_recovery_code")
    op.drop_table("mr_admin_totp")
    op.drop_column("admin_users", "totp_required")
