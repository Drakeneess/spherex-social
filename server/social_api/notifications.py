"""Personal notification inbox; only committed social actions generate alerts.

No background workers or third-party push provider are required: the browser
periodically polls unread counts. All endpoints require authentication.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session, aliased

from .auth import current_user
from .db import get_db
from .models import Comment, Notification, Post, User

router = APIRouter(prefix='/v1', tags=['notifications'])
NotificationKind = Literal['like','comment','reply','repost','follow']


class NotificationOut(BaseModel):
    id: UUID
    kind: NotificationKind
    actor_username: str
    actor_display_name: str
    post_id: UUID | None
    post_author_username: str | None
    comment_preview: str | None
    created_at: datetime
    read_at: datetime | None


class NotificationCount(BaseModel):
    unread: int


def event_key(kind: str, actor_id: UUID, target_id: UUID, recipient_id: UUID | None = None) -> str:
    return ':'.join((kind, str(actor_id), str(target_id),
                     str(recipient_id) if recipient_id is not None else ''))


def queue_notification(
    db: Session, *, kind: NotificationKind, recipient_id: UUID, actor_id: UUID,
    target_id: UUID, post_id: UUID | None = None, comment_id: UUID | None = None,
) -> None:
    """Attach to the caller's current transaction; no self notifications."""
    if recipient_id == actor_id:
        return
    db.add(Notification(
        recipient_id=recipient_id, actor_id=actor_id, kind=kind,
        event_key=event_key(kind, actor_id, target_id,
                            recipient_id if kind in ('comment','reply') else None),
        post_id=post_id, comment_id=comment_id,
    ))


def remove_notification(db: Session, *, kind: str,
                        actor_id: UUID, target_id: UUID) -> None:
    """Undoing a like, repost or follow removes its corresponding alert."""
    db.execute(delete(Notification).where(
        Notification.event_key == event_key(kind, actor_id, target_id),
    ))


def _visible_filter(user_id: UUID):
    # A private post that changes ownership/visibility must not be leaked by
    # the notification preview or unread badge.
    return or_(
        Notification.post_id.is_(None),
        Post.visibility != 'private',
        Post.author_id == user_id,
    )


@router.get('/users/me/notifications/count', response_model=NotificationCount)
def unread_count(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    count = db.scalar(
        select(func.count()).select_from(Notification)
        .outerjoin(Post, Notification.post_id == Post.id)
        .where(Notification.recipient_id == user.id,
               Notification.read_at.is_(None), _visible_filter(user.id))
    )
    return NotificationCount(unread=int(count or 0))


@router.get('/users/me/notifications', response_model=list[NotificationOut])
def list_notifications(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
    unread_only: bool = False,
):
    actor = aliased(User)
    author = aliased(User)
    query = (
        select(Notification, actor.username, actor.display_name,
               author.username, Comment.body)
        .join(actor, actor.id == Notification.actor_id)
        .outerjoin(Post, Post.id == Notification.post_id)
        .outerjoin(author, author.id == Post.author_id)
        .outerjoin(Comment, Comment.id == Notification.comment_id)
        .where(Notification.recipient_id == user.id, _visible_filter(user.id))
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.execute(
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit).offset(offset)
    ).all()
    return [
        NotificationOut(
            id=item.id, kind=item.kind,
            actor_username=actor_name, actor_display_name=actor_display,
            post_id=item.post_id, post_author_username=author_name,
            comment_preview=body[:160] if body else None,
            created_at=item.created_at, read_at=item.read_at,
        )
        for item, actor_name, actor_display, author_name, body in rows
    ]


@router.post('/users/me/notifications/read-all', status_code=204)
def read_all_notifications(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    visible_ids = (
        select(Notification.id)
        .outerjoin(Post, Post.id == Notification.post_id)
        .where(Notification.recipient_id == user.id,
               Notification.read_at.is_(None), _visible_filter(user.id))
    )
    db.execute(
        update(Notification)
        .where(Notification.id.in_(visible_ids))
        .values(read_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return Response(status_code=204)


@router.post('/users/me/notifications/{notification_id}/read', status_code=204)
def read_notification(
    notification_id: UUID,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    entry = db.scalar(
        select(Notification)
        .outerjoin(Post, Post.id == Notification.post_id)
        .where(Notification.id == notification_id,
               Notification.recipient_id == user.id,
               _visible_filter(user.id))
    )
    if entry is None:
        raise HTTPException(status_code=404, detail='Notificación no encontrada')
    if entry.read_at is None:
        entry.read_at = datetime.now(timezone.utc)
        db.commit()
    return Response(status_code=204)
