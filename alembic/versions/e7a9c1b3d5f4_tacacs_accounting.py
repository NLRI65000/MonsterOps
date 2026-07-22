
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "e7a9c1b3d5f4"
down_revision = "d4f6b8c0e2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_tacacs_acct_record",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column(
            "client_id",
            sa.Integer(),
            sa.ForeignKey("mr_tacacs_client.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("client_name", sa.String(64), nullable=True),
        sa.Column("record_type", sa.String(8), nullable=False),
        sa.Column("priv_lvl", sa.Integer(), nullable=True),
        sa.Column("port", sa.String(64), nullable=True),
        sa.Column("rem_addr", sa.String(64), nullable=True),
        sa.Column("service", sa.String(32), nullable=True),
        sa.Column("cmd", sa.Text(), nullable=True),
        sa.Column("task_id", sa.String(64), nullable=True),
        sa.Column("elapsed_time", sa.Integer(), nullable=True),
        sa.Column("args", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_mr_tacacs_acct_record_username", "mr_tacacs_acct_record", ["username"])
    op.create_index(
        "ix_mr_tacacs_acct_record_record_type", "mr_tacacs_acct_record", ["record_type"]
    )
    op.create_index("ix_mr_tacacs_acct_record_created_at", "mr_tacacs_acct_record", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_mr_tacacs_acct_record_created_at", table_name="mr_tacacs_acct_record")
    op.drop_index("ix_mr_tacacs_acct_record_record_type", table_name="mr_tacacs_acct_record")
    op.drop_index("ix_mr_tacacs_acct_record_username", table_name="mr_tacacs_acct_record")
    op.drop_table("mr_tacacs_acct_record")
