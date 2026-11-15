"""Read-only operational, feed and observation endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from .db import get_db
from .models import Post, PostHashtag, User
from .post_content import normalize_tag
from .posts import PostOut, bookmarked_ids, counts_by_post, optional_user, reposted_ids, post_extras, serialize

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
    db: Session = Depends(get_db),
    viewer: User | None = Depends(optional_user),
):
    # Chronological public feed: personalization comes later.
    query=select(Post,User.username).join(User,Post.author_id==User.id).where(Post.visibility=='public')
    if tag:
        normalized=normalize_tag(tag)
        if normalized is None:
            raise HTTPException(status_code=422,detail='Hashtag inválido')
        query=query.join(PostHashtag,PostHashtag.post_id==Post.id).where(PostHashtag.tag==normalized)
    rows=db.execute(query.order_by(Post.created_at.desc(),Post.id.desc())
                    .limit(limit).offset(offset)).all()
    counts = counts_by_post(db, [post.id for post, _ in rows])
    ids = [post.id for post, _ in rows]
    viewer_reposts = reposted_ids(db, viewer, ids)
    viewer_bookmarks = bookmarked_ids(db, viewer, ids)
    media,tags=post_extras(db,ids)
    return [
        serialize(post, username, counts, viewer_reposts=viewer_reposts,
                  viewer_bookmarks=viewer_bookmarks,
                  media=media.get(post.id),hashtags=tags.get(post.id))
        for post, username in rows
    ]
