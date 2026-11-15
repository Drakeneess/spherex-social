"""Text, photo, link and hashtag support for community posts.

Revision ID: 7b6d2ef4ab08
Revises: 5c829df0a3e1
"""
import re
import uuid
from alembic import op
import sqlalchemy as sa

revision='7b6d2ef4ab08'
down_revision='5c829df0a3e1'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('posts',sa.Column('link_url',sa.Text(),nullable=True))
    op.create_table('post_hashtags',
        sa.Column('post_id',sa.Uuid(),nullable=False),
        sa.Column('tag',sa.String(30),nullable=False),
        sa.ForeignKeyConstraint(['post_id'],['posts.id'],ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('post_id','tag'))
    op.create_index('ix_post_hashtags_tag','post_hashtags',['tag'])
    connection=op.get_bind()
    table=sa.table('post_hashtags',sa.column('post_id',sa.Uuid()),sa.column('tag',sa.String(30)))
    regex=re.compile(r'(?<![\w#])#([^\W_][\w]{1,29})',re.UNICODE)
    for post_id,caption in connection.execute(sa.text('SELECT id,caption FROM posts')).all():
        tags={t for match in regex.finditer(caption or '') if len(t:=match.group(1).casefold())<=30}
        if tags:
            connection.execute(table.insert(),[
                {'post_id':uuid.UUID(str(post_id)),'tag':tag} for tag in sorted(tags)][:12])


def downgrade():
    op.drop_index('ix_post_hashtags_tag',table_name='post_hashtags')
    op.drop_table('post_hashtags')
    op.drop_column('posts','link_url')
