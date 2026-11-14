"""Authenticated post CRUD, link sharing and visibility-aware profile listings."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import bearer, current_user
from .db import get_db
from .models import Comment, Observation, Post, PostLike, User

router = APIRouter(prefix='/v1', tags=['posts'])
Visibility = Literal['public', 'unlisted', 'private']


class PostCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    caption: str = Field(min_length=1, max_length=3000)
    visibility: Visibility = 'public'
    observation_id: UUID | None = None

    @field_validator('caption')
    @classmethod
    def clean_caption(cls, caption: str) -> str:
        caption = caption.strip()
        if not caption:
            raise ValueError('Caption cannot be blank')
        return caption


class PostPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    caption: str | None = Field(default=None, min_length=1, max_length=3000)
    visibility: Visibility | None = None
    observation_id: UUID | None = None

    @field_validator('caption')
    @classmethod
    def clean_caption(cls, caption: str | None) -> str:
        if caption is None:
            raise ValueError('Caption cannot be null')
        caption = caption.strip()
        if not caption:
            raise ValueError('Caption cannot be blank')
        return caption

    @field_validator('visibility')
    @classmethod
    def check_visibility(cls, visibility: Visibility | None) -> Visibility:
        if visibility is None:
            raise ValueError('Visibility cannot be null')
        return visibility


class PostOut(BaseModel):
    id: UUID
    username: str
    caption: str
    observation_id: UUID | None
    visibility: Visibility
    created_at: datetime
    likes_count: int = 0
    comments_count: int = 0


def counts_by_post(db: Session, post_ids: list[UUID]) -> dict[UUID, tuple[int, int]]:
    """Aggregate interactions in two queries for the whole page (avoid N+1)."""
    if not post_ids:
        return {}
    likes = dict(db.execute(
        select(PostLike.post_id, func.count())
        .where(PostLike.post_id.in_(post_ids))
        .group_by(PostLike.post_id)
    ).all())
    comments = dict(db.execute(
        select(Comment.post_id, func.count())
        .where(Comment.post_id.in_(post_ids))
        .group_by(Comment.post_id)
    ).all())
    return {pid: (int(likes.get(pid, 0)), int(comments.get(pid, 0))) for pid in post_ids}


def optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    # Anonymous requests are permitted; invalid supplied tokens are not ignored.
    return None if credentials is None else current_user(credentials, db)


def serialize(post: Post, username: str, counts: dict[UUID, tuple[int, int]] | None = None) -> PostOut:
    likes, comments = (counts or {}).get(post.id, (0, 0))
    return PostOut(
        id=post.id, username=username, caption=post.caption,
        observation_id=post.observation_id, visibility=post.visibility,
        created_at=post.created_at, likes_count=likes, comments_count=comments,
    )


def ensure_observation(db: Session, observation_id: UUID | None) -> None:
    if observation_id is not None and db.get(Observation, observation_id) is None:
        raise HTTPException(status_code=404, detail='Observation not found')


def owned_post(db: Session, post_id: UUID, user: User) -> Post:
    post = db.get(Post, post_id)
    # Return identical errors for an absent post and a post owned by someone else.
    if post is None or post.author_id != user.id:
        raise HTTPException(status_code=404, detail='Post not found')
    return post


@router.post('/posts', response_model=PostOut, status_code=status.HTTP_201_CREATED)
def create_post(
    body: PostCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_observation(db, body.observation_id)
    post = Post(
        author_id=user.id, caption=body.caption,
        visibility=body.visibility, observation_id=body.observation_id,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return serialize(post, user.username)


@router.get('/posts/{post_id}', response_model=PostOut)
def get_post(
    post_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
):
    row = db.execute(
        select(Post, User.username).join(User, User.id == Post.author_id)
        .where(Post.id == post_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Post not found')
    post, username = row
    if post.visibility == 'private' and (viewer is None or viewer.id != post.author_id):
        raise HTTPException(status_code=404, detail='Post not found')
    # Unlisted posts can be accessed via their direct link.
    return serialize(post, username, counts_by_post(db, [post.id]))


@router.patch('/posts/{post_id}', response_model=PostOut)
def update_post(
    post_id: UUID,
    body: PostPatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    post = owned_post(db, post_id, user)
    if 'observation_id' in body.model_fields_set:
        ensure_observation(db, body.observation_id)
    for key in body.model_fields_set:
        setattr(post, key, getattr(body, key))
    db.commit()
    db.refresh(post)
    return serialize(post, user.username, counts_by_post(db, [post.id]))


@router.delete('/posts/{post_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    post = owned_post(db, post_id, user)
    db.delete(post)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get('/users/{username}/posts', response_model=list[PostOut])
def user_posts(
    username: str,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    owner = db.scalar(select(User).where(User.username == username.strip().lower()))
    if owner is None:
        raise HTTPException(status_code=404, detail='User not found')
    stmt = select(Post).where(Post.author_id == owner.id)
    if viewer is None or viewer.id != owner.id:
        stmt = stmt.where(Post.visibility == 'public')
    posts = db.scalars(
        stmt.order_by(Post.created_at.desc(), Post.id.desc()).limit(limit).offset(offset)
    ).all()
    counts = counts_by_post(db, [post.id for post in posts])
    return [serialize(post, owner.username, counts) for post in posts]
