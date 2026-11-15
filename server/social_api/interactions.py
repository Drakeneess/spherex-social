"""Social interactions: likes, saved posts, comments and user follows.

All writes require an authenticated user. Inaccessible private posts return 404
without disclosing whether they exist; unlisted posts work by direct ID.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import Bookmark, Comment, Follow, Post, PostLike, PostRepost, User
from .posts import PostOut, bookmarked_ids, counts_by_post, optional_user, reposted_ids, serialize

router = APIRouter(prefix='/v1', tags=['interactions'])


def get_visible_post(db: Session, post_id: UUID, viewer: User | None) -> Post:
    post = db.get(Post, post_id)
    if post is None or (
        post.visibility == 'private' and (viewer is None or viewer.id != post.author_id)
    ):
        raise HTTPException(status_code=404, detail='Post not found')
    return post


def get_named_user(db: Session, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None:
        raise HTTPException(status_code=404, detail='User not found')
    return user


def add_once(db: Session, row, model, key: tuple, target_exists) -> None:
    """Composite primary keys enforce uniqueness even under concurrent requests."""
    if db.get(model, key) is not None:
        return
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Retry collision on the unique pair is an idempotent success, but
        # a concurrently deleted post/user is a missing resource.
        if not target_exists():
            raise HTTPException(status_code=404, detail='Resource not found') from exc
        if db.get(model, key) is None:
            raise HTTPException(status_code=409, detail='Concurrent write conflict') from exc


def remove_if_present(db: Session, model, key: tuple) -> None:
    row = db.get(model, key)
    if row is not None:
        db.delete(row)
        db.commit()


@router.post('/posts/{post_id}/like', status_code=status.HTTP_204_NO_CONTENT)
def like_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    get_visible_post(db, post_id, user)
    add_once(
        db, PostLike(post_id=post_id, user_id=user.id), PostLike, (user.id, post_id),
        lambda: db.get(Post, post_id) is not None,
    )
    return Response(status_code=204)


@router.delete('/posts/{post_id}/like', status_code=status.HTTP_204_NO_CONTENT)
def unlike_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    get_visible_post(db, post_id, user)
    remove_if_present(db, PostLike, (user.id, post_id))
    return Response(status_code=204)


@router.post('/posts/{post_id}/repost', status_code=status.HTTP_204_NO_CONTENT)
def repost_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    post = db.get(Post, post_id)
    # Profiles are public. Never expose unlisted or private posts via reposts.
    if post is None or post.visibility != 'public':
        raise HTTPException(status_code=404, detail='Post not found')
    if post.author_id == user.id:
        raise HTTPException(status_code=400, detail='Tu publicación ya aparece en tu perfil')
    add_once(
        db, PostRepost(post_id=post_id, user_id=user.id), PostRepost,
        (user.id, post_id),
        lambda: (target := db.get(Post, post_id)) is not None and target.visibility == 'public',
    )
    return Response(status_code=204)


@router.delete('/posts/{post_id}/repost', status_code=status.HTTP_204_NO_CONTENT)
def remove_repost(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    # The repost remains removable even after its original becomes private.
    remove_if_present(db, PostRepost, (user.id, post_id))
    return Response(status_code=204)


@router.post('/posts/{post_id}/bookmark', status_code=status.HTTP_204_NO_CONTENT)
def save_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    get_visible_post(db, post_id, user)
    add_once(
        db, Bookmark(post_id=post_id, user_id=user.id), Bookmark, (user.id, post_id),
        lambda: db.get(Post, post_id) is not None,
    )
    return Response(status_code=204)


@router.delete('/posts/{post_id}/bookmark', status_code=status.HTTP_204_NO_CONTENT)
def unsave_post(
    post_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    get_visible_post(db, post_id, user)
    remove_if_present(db, Bookmark, (user.id, post_id))
    return Response(status_code=204)


@router.get('/users/me/bookmarks', response_model=list[PostOut])
def my_bookmarks(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    rows = db.execute(
        select(Post, User.username)
        .join(Bookmark, Bookmark.post_id == Post.id)
        .join(User, User.id == Post.author_id)
        .where(
            Bookmark.user_id == user.id,
            (Post.visibility != 'private') | (Post.author_id == user.id),
        )
        .order_by(Bookmark.created_at.desc(), Post.id.desc())
        .limit(limit).offset(offset)
    ).all()
    counts = counts_by_post(db, [post.id for post, _ in rows])
    ids = [post.id for post, _ in rows]
    viewer_reposts = reposted_ids(db, user, ids)
    viewer_bookmarks = bookmarked_ids(db, user, ids)
    return [
        serialize(post, username, counts, viewer_reposts=viewer_reposts,
                  viewer_bookmarks=viewer_bookmarks)
        for post, username in rows
    ]


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    body: str = Field(min_length=1, max_length=2000)
    parent_id: UUID | None = None

    @field_validator('body')
    @classmethod
    def trim_body(cls, body: str) -> str:
        body = body.strip()
        if not body:
            raise ValueError('Comment cannot be blank')
        return body


class CommentOut(BaseModel):
    id: UUID
    post_id: UUID
    username: str
    parent_id: UUID | None
    body: str
    created_at: datetime


@router.get('/posts/{post_id}/comments', response_model=list[CommentOut])
def list_comments(
    post_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    get_visible_post(db, post_id, viewer)
    rows = db.execute(
        select(Comment, User.username)
        .join(User, User.id == Comment.author_id)
        .where(Comment.post_id == post_id)
        .order_by(Comment.created_at.asc(), Comment.id.asc())
        .limit(limit).offset(offset)
    ).all()
    return [
        CommentOut(id=comment.id, post_id=comment.post_id, username=username,
                   parent_id=comment.parent_id, body=comment.body, created_at=comment.created_at)
        for comment, username in rows
    ]


@router.post('/posts/{post_id}/comments', response_model=CommentOut, status_code=201)
def comment_on_post(
    post_id: UUID,
    body: CommentCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    get_visible_post(db, post_id, user)
    if body.parent_id is not None:
        parent = db.get(Comment, body.parent_id)
        if parent is None or parent.post_id != post_id:
            raise HTTPException(status_code=404, detail='Parent comment not found')
    comment = Comment(author_id=user.id, post_id=post_id, parent_id=body.parent_id,
                      body=body.body, created_at=datetime.now(timezone.utc))
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return CommentOut(id=comment.id, post_id=post_id, username=user.username,
                      parent_id=comment.parent_id, body=comment.body, created_at=comment.created_at)


@router.delete('/posts/{post_id}/comments/{comment_id}', status_code=204)
def delete_comment(
    post_id: UUID,
    comment_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    post = get_visible_post(db, post_id, user)
    comment = db.get(Comment, comment_id)
    if comment is None or comment.post_id != post_id:
        raise HTTPException(status_code=404, detail='Comment not found')
    # A post owner may moderate their own comments section.
    if user.id not in (comment.author_id, post.author_id):
        raise HTTPException(status_code=403, detail='Not allowed to remove this comment')
    db.delete(comment)
    db.commit()
    return Response(status_code=204)


@router.post('/users/{username}/follow', status_code=204)
def follow_user(
    username: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    target = get_named_user(db, username)
    if target.id == user.id:
        raise HTTPException(status_code=400, detail='You cannot follow yourself')
    add_once(
        db, Follow(follower_id=user.id, following_id=target.id), Follow,
        (user.id, target.id), lambda: db.get(User, target.id) is not None,
    )
    return Response(status_code=204)


@router.delete('/users/{username}/follow', status_code=204)
def unfollow_user(
    username: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    target = get_named_user(db, username)
    if target.id == user.id:
        raise HTTPException(status_code=400, detail='You cannot unfollow yourself')
    remove_if_present(db, Follow, (user.id, target.id))
    return Response(status_code=204)


class SocialCounts(BaseModel):
    username: str
    followers_count: int
    following_count: int
    is_following: bool


@router.get('/users/{username}/stats', response_model=SocialCounts)
def user_social_counts(
    username: str,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
):
    target = get_named_user(db, username)
    followers = db.scalar(select(func.count()).select_from(Follow).where(Follow.following_id == target.id))
    following = db.scalar(select(func.count()).select_from(Follow).where(Follow.follower_id == target.id))
    is_following = viewer is not None and db.get(Follow, (viewer.id, target.id)) is not None
    return SocialCounts(username=target.username, followers_count=followers or 0,
                        following_count=following or 0, is_following=is_following)
