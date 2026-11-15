"""Editable user profile images and personal website.

Revision ID: a97c2b716e41
Revises: 83c4aaf91d12
"""
from alembic import op
import sqlalchemy as sa

revision='a97c2b716e41'
down_revision='83c4aaf91d12'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('users',sa.Column('website',sa.String(300),nullable=True))
    op.add_column('users',sa.Column('avatar_version',sa.Uuid(),nullable=True))
    op.add_column('users',sa.Column('cover_version',sa.Uuid(),nullable=True))


def downgrade():
    op.drop_column('users','cover_version')
    op.drop_column('users','avatar_version')
    op.drop_column('users','website')
