"""Store public post reposts shown in the sharing user's profile.

Revision ID: 3c8e7a91b4d2
Revises: b60ce72df9af
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = '3c8e7a91b4d2'
down_revision = 'b60ce72df9af'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'post_reposts',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'post_id'),
    )
    op.create_index('ix_post_reposts_post_id', 'post_reposts', ['post_id'])


def downgrade():
    op.drop_index('ix_post_reposts_post_id', table_name='post_reposts')
    op.drop_table('post_reposts')
