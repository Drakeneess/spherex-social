"""Read-only operational, feed and observation endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from .db import get_db
from .models import Post, User
from .posts import PostOut, bookmarked_ids, counts_by_post, optional_user, reposted_ids, serialize

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
    db: Session = Depends(get_db),
    viewer: User | None = Depends(optional_user),
):
    # Chronological public feed: personalization comes later.
    rows = db.execute(
        select(Post, User.username)
        .join(User, Post.author_id == User.id)
        .where(Post.visibility == 'public')
        .order_by(Post.created_at.desc(), Post.id.desc())
        .limit(limit).offset(offset)
    ).all()
    counts = counts_by_post(db, [post.id for post, _ in rows])
    ids = [post.id for post, _ in rows]
    viewer_reposts = reposted_ids(db, viewer, ids)
    viewer_bookmarks = bookmarked_ids(db, viewer, ids)
    return [
        serialize(post, username, counts, viewer_reposts=viewer_reposts,
                  viewer_bookmarks=viewer_bookmarks)
        for post, username in rows
    ]
