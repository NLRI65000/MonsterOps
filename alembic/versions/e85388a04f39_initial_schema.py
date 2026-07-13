from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e85388a04f39'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS nas (
            id serial PRIMARY KEY,
            nasname text NOT NULL,
            shortname text,
            type text DEFAULT 'other',
            ports integer,
            secret text NOT NULL DEFAULT 'secret',
            server text,
            community text,
            description text
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radcheck (
            id serial PRIMARY KEY,
            username text NOT NULL DEFAULT '',
            attribute text NOT NULL DEFAULT '',
            op character(2) NOT NULL DEFAULT '==',
            value text NOT NULL DEFAULT ''
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radreply (
            id serial PRIMARY KEY,
            username text NOT NULL DEFAULT '',
            attribute text NOT NULL DEFAULT '',
            op character(2) NOT NULL DEFAULT '=',
            value text NOT NULL DEFAULT ''
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radgroupcheck (
            id serial PRIMARY KEY,
            groupname text NOT NULL DEFAULT '',
            attribute text NOT NULL DEFAULT '',
            op character(2) NOT NULL DEFAULT '==',
            value text NOT NULL DEFAULT ''
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radgroupreply (
            id serial PRIMARY KEY,
            groupname text NOT NULL DEFAULT '',
            attribute text NOT NULL DEFAULT '',
            op character(2) NOT NULL DEFAULT '=',
            value text NOT NULL DEFAULT ''
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radusergroup (
            id serial PRIMARY KEY,
            username text NOT NULL DEFAULT '',
            groupname text NOT NULL DEFAULT '',
            priority integer NOT NULL DEFAULT 0
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radpostauth (
            id bigserial PRIMARY KEY,
            username text NOT NULL,
            pass text,
            reply text,
            authdate timestamp with time zone NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS radacct (
            radacctid bigserial PRIMARY KEY,
            acctsessionid text NOT NULL,
            acctuniqueid text NOT NULL,
            username text,
            groupname text,
            realm text,
            nasipaddress inet NOT NULL,
            nasportid text,
            nasporttype text,
            acctstarttime timestamp with time zone,
            acctupdatetime timestamp with time zone,
            acctstoptime timestamp with time zone,
            acctinterval integer,
            acctsessiontime integer,
            acctauthentic text,
            connectinfo_start text,
            connectinfo_stop text,
            acctinputoctets bigint,
            acctoutputoctets bigint,
            calledstationid text,
            callingstationid text,
            acctterminatecause text,
            servicetype text,
            framedprotocol text,
            framedipaddress inet,
            framedipv6address inet,
            framedipv6prefix text,
            framedinterfaceid text,
            delegatedipv6prefix text,
            class text,
            loopbackipv6 text,
            startinterval integer,
            nasidentifier text
        )
    """)
    op.create_table('admin_users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_users_email'), 'admin_users', ['email'], unique=True)
    op.create_index(op.f('ix_admin_users_username'), 'admin_users', ['username'], unique=True)
    op.create_table('radippool',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('pool_name', sa.Text(), nullable=False),
    sa.Column('framedipaddress', postgresql.INET(), nullable=False),
    sa.Column('nasipaddress', postgresql.INET(), nullable=False),
    sa.Column('calledstationid', sa.Text(), nullable=False),
    sa.Column('callingstationid', sa.Text(), nullable=False),
    sa.Column('expiry_time', postgresql.TIMESTAMP(timezone=True), nullable=True),
    sa.Column('username', sa.Text(), nullable=False),
    sa.Column('pool_key', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('radippool')
    op.drop_index(op.f('ix_admin_users_username'), table_name='admin_users')
    op.drop_index(op.f('ix_admin_users_email'), table_name='admin_users')
    op.drop_table('admin_users')
