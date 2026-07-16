
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

from alembic import op

revision = "e1f4a9c2b6d8"
down_revision = "d2e8b3f1a9c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_webhook_subs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("secret", sa.Text(), nullable=True),
        sa.Column("events", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_mr_webhook_subs_enabled", "mr_webhook_subs", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_mr_webhook_subs_enabled", table_name="mr_webhook_subs")
    op.drop_table("mr_webhook_subs")
