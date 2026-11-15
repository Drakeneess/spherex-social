"""Read-only operational, feed and observation endpoints."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from .db import get_db
from .models import Follow, Post, PostHashtag, User
from .recommendations import recommended_rows
from .post_content import normalize_tag
from .posts import PostOut, bookmarked_ids, counts_by_post, optional_user, reposted_ids, liked_ids, post_extras, serialize

router = APIRouter(prefix='/v1', tags=['social'])


@router.get('/health', tags=['operations'])
def health() -> dict[str,str]:
    return {'status': 'ok', 'service': 'spherex-social-api'}


@router.get('/ready', tags=['operations'])
def ready(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text('SELECT 1')).scalar_one()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='Database not ready') from exc
    return {'status': 'ready', 'database': 'connected'}


@router.get('/feed', response_model=list[PostOut])
def feed(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    tag: str | None = Query(default=None, max_length=32),
    mode: Literal['recent', 'following', 'for_you'] = Query('recent'),
    db: Session = Depends(get_db),
    viewer: User | None = Depends(optional_user),
):
    # Hashtag discovery and "recent" always remain chronological. A request
    # for "following" never silently reveals private posts from followed users.
    reasons = {}
    if mode == 'following' and viewer is None:
        raise HTTPException(status_code=401, detail='Inicia sesión para ver a quién sigues')
    if tag:
        normalized = normalize_tag(tag)
        if normalized is None:
            raise HTTPException(status_code=422, detail='Hashtag inválido')
    if mode == 'for_you' and not tag:
        personalized = recommended_rows(db, viewer, limit, offset)
        rows = [(post, username) for post, username, _ in personalized]
        reasons = {post.id: reason for post, _, reason in personalized}
    else:
        query = (select(Post, User.username)
                 .join(User, Post.author_id == User.id)
                 .where(Post.visibility == 'public'))
        if mode == 'following' and not tag:
            query = query.join(Follow, Follow.following_id == Post.author_id).where(
                Follow.follower_id == viewer.id
            )
        if tag:
            query = query.join(PostHashtag, PostHashtag.post_id == Post.id).where(
                PostHashtag.tag == normalized
            )
        rows = db.execute(
            query.order_by(Post.created_at.desc(), Post.id.desc())
            .limit(limit).offset(offset)
        ).all()
    counts = counts_by_post(db, [post.id for post, _ in rows])
    ids = [post.id for post, _ in rows]
    viewer_reposts = reposted_ids(db, viewer, ids)
    viewer_bookmarks = bookmarked_ids(db, viewer, ids)
    viewer_likes = liked_ids(db, viewer, ids)
    media,tags=post_extras(db,ids)
    return [
        serialize(post, username, counts, viewer_reposts=viewer_reposts,
                  viewer_bookmarks=viewer_bookmarks, viewer_likes=viewer_likes,
                  media=media.get(post.id),hashtags=tags.get(post.id),
                  recommended_reason=reasons.get(post.id))
        for post, username in rows
    ]
