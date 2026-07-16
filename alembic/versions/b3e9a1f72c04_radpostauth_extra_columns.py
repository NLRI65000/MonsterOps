
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET

from alembic import op

revision = "b3e9a1f72c04"
down_revision = "c7a1e3f92b84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("radpostauth", sa.Column("nasipaddress", INET(), nullable=True))
    op.add_column("radpostauth", sa.Column("nasidentifier", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("radpostauth", "nasidentifier")
    op.drop_column("radpostauth", "nasipaddress")
