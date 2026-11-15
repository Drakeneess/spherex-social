"""Associate post animations with persisted sky jobs.

Revision ID: b60ce72df9af
Revises: 7ea90d32b540
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = 'b60ce72df9af'
down_revision = '7ea90d32b540'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('posts') as batch:
        batch.add_column(sa.Column('sky_job_id', sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            'fk_posts_sky_job_id', 'sky_search_jobs',
            ['sky_job_id'], ['id'], ondelete='SET NULL',
        )
        batch.create_index('ix_posts_sky_job_id', ['sky_job_id'])


def downgrade():
    with op.batch_alter_table('posts') as batch:
        batch.drop_index('ix_posts_sky_job_id')
        batch.drop_constraint('fk_posts_sky_job_id', type_='foreignkey')
        batch.drop_column('sky_job_id')
