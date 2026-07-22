
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "d4f6b8c0e2a3"
down_revision = "c3e5a7b9d1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_tacacs_command_rule",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("mr_tacacs_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("action", sa.String(8), nullable=False, server_default=sa.text("'permit'")),
        sa.Column("command", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_mr_tacacs_command_rule_user_id", "mr_tacacs_command_rule", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_mr_tacacs_command_rule_user_id", table_name="mr_tacacs_command_rule")
    op.drop_table("mr_tacacs_command_rule")
