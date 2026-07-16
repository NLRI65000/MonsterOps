
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "a9f3e2b1c0d8"
down_revision: Union[str, Sequence[str], None] = "d1e5f8a2c3b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None



def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_prevent_retrograde_stop()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.acctstoptime IS NOT NULL AND NEW.acctstoptime < NEW.acctstarttime THEN
                NEW.acctstoptime       := NULL;
                NEW.acctsessiontime    := NULL;
                NEW.acctterminatecause := '';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_retrograde_stop ON radacct")
    op.execute("""
        CREATE TRIGGER trg_prevent_retrograde_stop
        BEFORE INSERT OR UPDATE ON radacct
        FOR EACH ROW EXECUTE FUNCTION fn_prevent_retrograde_stop()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_retrograde_stop ON radacct")
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_retrograde_stop()")
