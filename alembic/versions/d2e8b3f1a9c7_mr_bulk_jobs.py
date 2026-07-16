
from __future__ import annotations

from alembic import op

revision = "d2e8b3f1a9c7"
down_revision = "c2a8f4e71b93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS mr_bulk_jobs (
            id          serial PRIMARY KEY,
            job_type    text NOT NULL,
            created_by  text NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now(),
            row_total   integer NOT NULL DEFAULT 0,
            row_ok      integer NOT NULL DEFAULT 0,
            row_skipped integer NOT NULL DEFAULT 0,
            row_error   integer NOT NULL DEFAULT 0,
            detail      jsonb
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS mr_bulk_jobs_created_at ON mr_bulk_jobs (created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mr_bulk_jobs")
