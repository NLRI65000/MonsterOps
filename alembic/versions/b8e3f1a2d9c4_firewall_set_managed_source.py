
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "b8e3f1a2d9c4"
down_revision = "a4d1c7e6b520"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mr_firewall_set",
        sa.Column("managed_source", sa.String(length=48), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("mr_firewall_set", "managed_source")
