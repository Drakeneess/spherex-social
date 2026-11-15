"""Bounded global search over public AstroGram content.

No private/unlisted post, account email, birthday or hidden profile field
appears in results. PostgreSQL and SQLite tests share the same SQLAlchemy
query expressions; user input is always parameterized, never raw SQL.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Post, PostHashtag, User

router = APIRouter(prefix="/v1", tags=["search"])


class UserHit(BaseModel):
    username: str
    display_name: str
    bio: str | None
    avatar_version: UUID | None
    avatar_color_start: str | None
    avatar_color_end: str | None


class PostHit(BaseModel):
    id: UUID
    username: str
    caption: str
    created_at: datetime
    observation_id: UUID | None
    has_media: bool = False


class HashtagHit(BaseModel):
    tag: str
    posts_count: int


class SearchResults(BaseModel):
    query: str
    users: list[UserHit] = Field(default_factory=list)
    posts: list[PostHit] = Field(default_factory=list)
    hashtags: list[HashtagHit] = Field(default_factory=list)
    more_users: bool = False
    more_posts: bool = False
    more_hashtags: bool = False


def _escaped(value: str) -> str:
    """Literal search across SQL LIKE wildcards (escape %, _ and backslash)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/search", response_model=SearchResults)
def global_search(
    q: str = Query(min_length=1, max_length=80),
    limit: int = Query(default=5, ge=1, le=20),
    offset: int = Query(default=0, ge=0, le=200),
    db: Session = Depends(get_db),
):
    raw = q.strip()
    needle = raw.lstrip("@#").strip().lower() if raw.startswith(("@", "#")) else raw.lower()
    # Avoid issuing expensive unbounded lookups for empty prefixes and one-char keys.
    if len(needle) < 2:
        return SearchResults(query=raw)

    search_users = not raw.startswith("#")
    search_posts = not raw.startswith("@")
    search_tags = not raw.startswith("@")
    starts = _escaped(needle) + "%"
    contains = "%" + _escaped(needle) + "%"
    result = SearchResults(query=raw)

    if search_users:
        username = func.lower(User.username)
        display = func.lower(User.display_name)
        weight = case(
            (username == needle, 0),
            (username.like(starts, escape="\\"), 1),
            (display.like(starts, escape="\\"), 2),
            (username.like(contains, escape="\\"), 3),
            else_=4,
        )
        users = db.scalars(
            select(User)
            .where(or_(
                username.like(contains, escape="\\"),
                display.like(contains, escape="\\"),
            ))
            .order_by(weight, username, User.id)
            .offset(offset).limit(limit + 1)
        ).all()
        result.more_users = len(users) > limit
        result.users = [
            UserHit(
                username=user.username,
                display_name=user.display_name,
                bio=user.bio[:140] if user.bio else None,
                avatar_version=user.avatar_version,
                avatar_color_start=user.avatar_color_start,
                avatar_color_end=user.avatar_color_end,
            )
            for user in users[:limit]
        ]

    if search_posts:
        caption = func.lower(Post.caption)
        # A #tag query uses its literal spelling; it must not hit the
        # substring "tag" somewhere else in an unrelated post.
        post_term = "#" + needle if raw.startswith("#") else needle
        literal = "%" + _escaped(post_term) + "%"
        begins = _escaped(post_term) + "%"
        matching_tags = select(PostHashtag.post_id).where(
            PostHashtag.post_id == Post.id,
            func.lower(PostHashtag.tag).like(starts, escape="\\"),
        ).exists()
        ranked = case((caption.like(begins, escape="\\"), 0), else_=1)
        query = (
            select(Post, User.username)
            .join(User, User.id == Post.author_id)
            .where(Post.visibility == "public")
            .where(or_(caption.like(literal, escape="\\"), matching_tags))
            .order_by(ranked, Post.created_at.desc(), Post.id.desc())
            .offset(offset).limit(limit + 1)
        )
        posts = db.execute(query).all()
        result.more_posts = len(posts) > limit
        result.posts = [
            PostHit(
                id=post.id,
                username=username,
                caption=post.caption[:260],
                created_at=post.created_at,
                observation_id=post.observation_id,
            )
            for post, username in posts[:limit]
        ]

    if search_tags:
        tag = func.lower(PostHashtag.tag)
        matching = (
            select(PostHashtag.tag, func.count(PostHashtag.post_id).label("posts_count"))
            .join(Post, Post.id == PostHashtag.post_id)
            .where(Post.visibility == "public")
            .where(tag.like(starts, escape="\\"))
            .group_by(PostHashtag.tag)
            .order_by(case((tag == needle, 0), else_=1),
                      func.count(PostHashtag.post_id).desc(), tag)
            .offset(offset).limit(limit + 1)
        )
        tags = db.execute(matching).all()
        result.more_hashtags = len(tags) > limit
        result.hashtags = [
            HashtagHit(tag=key, posts_count=count)
            for key, count in tags[:limit]
        ]

    return result
