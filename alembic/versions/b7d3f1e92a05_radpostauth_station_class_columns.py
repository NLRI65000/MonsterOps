from __future__ import annotations

from alembic import op

revision = 'b7d3f1e92a05'
down_revision = 'a9f3e2b1c0d8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS calledstationid text")
    op.execute("ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS callingstationid text")
    op.execute('ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS "class" text')


def downgrade() -> None:
    op.execute('ALTER TABLE radpostauth DROP COLUMN IF EXISTS "class"')
    op.execute("ALTER TABLE radpostauth DROP COLUMN IF EXISTS callingstationid")
    op.execute("ALTER TABLE radpostauth DROP COLUMN IF EXISTS calledstationid")
