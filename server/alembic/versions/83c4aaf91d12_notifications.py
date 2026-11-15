"""Durable notifications for real social interactions.

Revision ID: 83c4aaf91d12
Revises: 7b6d2ef4ab08
"""
from alembic import op
import sqlalchemy as sa

revision = "83c4aaf91d12"
down_revision = "7b6d2ef4ab08"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'notifications',
        sa.Column('id', sa.Uuid(), primary_key=True, nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('actor_id', sa.Uuid(), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('event_key', sa.String(180), nullable=False),
        sa.Column('post_id', sa.Uuid(), nullable=True),
        sa.Column('comment_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.func.now()),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('like','comment','reply','repost','follow')",
                           name='ck_notifications_kind'),
        sa.CheckConstraint('recipient_id <> actor_id', name='ck_notifications_not_self'),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['comment_id'], ['comments.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('event_key'),
    )
    op.create_index('ix_notifications_recipient_created',
                    'notifications', ['recipient_id', 'created_at'])
    op.create_index('ix_notifications_recipient_unread',
                    'notifications', ['recipient_id', 'read_at'])


def downgrade():
    op.drop_index('ix_notifications_recipient_unread', table_name='notifications')
    op.drop_index('ix_notifications_recipient_created', table_name='notifications')
    op.drop_table('notifications')
