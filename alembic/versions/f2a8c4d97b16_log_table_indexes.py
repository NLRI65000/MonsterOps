from __future__ import annotations

from alembic import op

revision = "f2a8c4d97b16"
down_revision = "e7c3a9d15f84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_radpostauth_authdate", "radpostauth", ["authdate"])


def downgrade() -> None:
    op.drop_index("ix_radpostauth_authdate", table_name="radpostauth")
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
