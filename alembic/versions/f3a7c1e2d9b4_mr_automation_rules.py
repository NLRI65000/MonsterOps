
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "f3a7c1e2d9b4"
down_revision = "e1f4a9c2b6d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mr_automation_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("event_pattern", sa.Text(), nullable=False),
        sa.Column("conditions", JSONB(), nullable=True),
        sa.Column("action_type", sa.Text(), nullable=False),
        sa.Column("action_config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("last_triggered_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_automation_rules_enabled", "mr_automation_rules", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_automation_rules_enabled", table_name="mr_automation_rules")
    op.drop_table("mr_automation_rules")
