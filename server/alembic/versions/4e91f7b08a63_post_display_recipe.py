"""Preserve non-destructive display recipes with published observations.

Revision ID: 4e91f7b08a63
Revises: 3c8e7a91b4d2
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = "4e91f7b08a63"
down_revision = "3c8e7a91b4d2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("posts", sa.Column("display_recipe", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("posts", "display_recipe")
