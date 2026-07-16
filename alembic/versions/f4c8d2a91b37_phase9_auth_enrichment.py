
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f4c8d2a91b37"
down_revision = "b3e9a1f72c04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("radpostauth", sa.Column("authmethod", sa.Text(), nullable=True))
    op.add_column("radpostauth", sa.Column("failurereason", sa.Text(), nullable=True))
    op.add_column("radpostauth", sa.Column("auth_latency_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("radpostauth", "auth_latency_ms")
    op.drop_column("radpostauth", "failurereason")
    op.drop_column("radpostauth", "authmethod")
