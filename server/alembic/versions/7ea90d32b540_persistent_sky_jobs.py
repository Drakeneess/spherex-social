"""Persist astronomical sky jobs and metadata outside process memory.

Revision ID: 7ea90d32b540
Revises: 08a9709cee8e
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = '7ea90d32b540'
down_revision = '08a9709cee8e'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'sky_search_jobs',
        sa.Column('id', sa.Uuid(), primary_key=True, nullable=False),
        sa.Column('ra', sa.Float(), nullable=False),
        sa.Column('dec', sa.Float(), nullable=False),
        sa.Column('size_arcmin', sa.Float(), nullable=False),
        sa.Column('detector', sa.SmallInteger(), nullable=False),
        sa.Column('max_frames', sa.SmallInteger(), nullable=False),
        sa.Column('demo', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='queued'),
        sa.Column('source', sa.String(length=20), nullable=False, server_default='sia2'),
        sa.Column('total_matches', sa.Integer(), nullable=True),
        sa.Column('result_data', sa.JSON(), nullable=True),
        sa.Column('records_data', sa.JSON(), nullable=True),
        sa.Column('frame_states', sa.JSON(), nullable=True),
        sa.Column('discovery_data', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('lease_owner', sa.String(length=64), nullable=True),
        sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('ra >= 0 AND ra < 360', name='ck_sky_search_ra'),
        sa.CheckConstraint('dec BETWEEN -90 AND 90', name='ck_sky_search_dec'),
        sa.CheckConstraint('size_arcmin BETWEEN 1 AND 12', name='ck_sky_search_size'),
        sa.CheckConstraint('detector BETWEEN 1 AND 6', name='ck_sky_search_detector'),
        sa.CheckConstraint('max_frames BETWEEN 2 AND 16', name='ck_sky_search_frames'),
        sa.CheckConstraint(
            "status IN ('queued','catalog','frames','complete','partial','empty','failed','cancelled')",
            name='ck_sky_search_status',
        ),
    )
    op.create_index('ix_sky_search_status_lease', 'sky_search_jobs',
                    ['status', 'lease_until'])


def downgrade():
    op.drop_index('ix_sky_search_status_lease', table_name='sky_search_jobs')
    op.drop_table('sky_search_jobs')
