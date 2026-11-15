"""Profile color palettes and optional private birth date.

Revision ID: b8217e5d6a90
Revises: a97c2b716e41
"""
from alembic import op
import sqlalchemy as sa

revision='b8217e5d6a90'
down_revision='a97c2b716e41'
branch_labels=None
depends_on=None


def upgrade():
    for name in ('avatar_color_start','avatar_color_end','cover_color_start','cover_color_end'):
        op.add_column('users',sa.Column(name,sa.String(7),nullable=True))
    op.add_column('users',sa.Column('birth_date',sa.Date(),nullable=True))
    op.add_column('users',sa.Column('show_birthday',sa.Boolean(),
                                    nullable=False,server_default=sa.false()))


def downgrade():
    op.drop_column('users','show_birthday')
    op.drop_column('users','birth_date')
    for name in ('cover_color_end','cover_color_start','avatar_color_end','avatar_color_start'):
        op.drop_column('users',name)
