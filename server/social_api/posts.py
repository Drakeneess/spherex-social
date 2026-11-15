"""Authenticated post CRUD, link sharing and visibility-aware profile listings."""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.orm import Session
from sky_reveal import RevealRecipe

from .auth import bearer, current_user
from .db import get_db
from .models import Bookmark, Comment, Observation, Post, PostLike, PostRepost, SkySearchJob, User

router = APIRouter(prefix='/v1', tags=['posts'])
Visibility = Literal['public', 'unlisted', 'private']


class PostCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    caption: str = Field(min_length=1, max_length=3000)
    visibility: Visibility = 'public'
    observation_id: UUID | None = None
    sky_job_id: UUID | None = None
    display_recipe: RevealRecipe | None = None

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
    sky_job_id: UUID | None = None
    display_recipe: RevealRecipe | None = None

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
    display_recipe: RevealRecipe | None = None
    likes_count: int = 0
    comments_count: int = 0
    reposts_count: int = 0
    reposted_by_me: bool = False
    bookmarked_by_me: bool = False
    reposted_by: str | None = None
    reposted_at: datetime | None = None


def counts_by_post(db: Session, post_ids: list[UUID]) -> dict[UUID, tuple[int, int, int]]:
    """Aggregate interactions for each page without N+1 queries."""
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
    reposts = dict(db.execute(
        select(PostRepost.post_id, func.count())
        .where(PostRepost.post_id.in_(post_ids))
        .group_by(PostRepost.post_id)
    ).all())
    return {
        pid: (int(likes.get(pid, 0)), int(comments.get(pid, 0)), int(reposts.get(pid, 0)))
        for pid in post_ids
    }


def reposted_ids(db: Session, viewer: User | None, post_ids: list[UUID]) -> set[UUID]:
    if viewer is None or not post_ids:
        return set()
    return set(db.scalars(
        select(PostRepost.post_id)
        .where(PostRepost.user_id == viewer.id, PostRepost.post_id.in_(post_ids))
    ).all())


def bookmarked_ids(db: Session, viewer: User | None, post_ids: list[UUID]) -> set[UUID]:
    """One query for all bookmarks in a page; never expose another user's saves."""
    if viewer is None or not post_ids:
        return set()
    return set(db.scalars(
        select(Bookmark.post_id)
        .where(Bookmark.user_id == viewer.id, Bookmark.post_id.in_(post_ids))
    ).all())


def optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    # Anonymous requests are permitted; invalid supplied tokens are not ignored.
    return None if credentials is None else current_user(credentials, db)


def serialize(
    post: Post, username: str, counts: dict[UUID, tuple[int, int, int]] | None = None,
    *, viewer_reposts: set[UUID] | None = None,
    viewer_bookmarks: set[UUID] | None = None,
    reposted_by: str | None = None, reposted_at: datetime | None = None,
) -> PostOut:
    likes, comments, reposts = (counts or {}).get(post.id, (0, 0, 0))
    return PostOut(
        id=post.id, username=username, caption=post.caption,
        observation_id=post.observation_id, visibility=post.visibility,
        created_at=post.created_at, display_recipe=post.display_recipe,
        likes_count=likes, comments_count=comments,
        reposts_count=reposts, reposted_by_me=post.id in (viewer_reposts or set()),
        bookmarked_by_me=post.id in (viewer_bookmarks or set()),
        reposted_by=reposted_by, reposted_at=reposted_at,
    )


def ensure_observation(db: Session, observation_id: UUID | None) -> None:
    if observation_id is not None and db.get(Observation, observation_id) is None:
        raise HTTPException(status_code=404, detail='Observation not found')


def validate_blink_job(db: Session, observation_id: UUID | None,
                       job_id: UUID | None) -> UUID | None:
    """The attached preview must be from the same *real* field and detector."""
    if job_id is None:
        return None
    observation = db.get(Observation, observation_id) if observation_id else None
    job = db.get(SkySearchJob, job_id)
    if observation is None or job is None or job.demo or job.result_data is None:
        raise HTTPException(status_code=422, detail='La búsqueda no permite publicar imágenes reales')
    identical = (
        abs(job.ra - observation.ra_deg) <= 1e-7
        and abs(job.dec - observation.dec_deg) <= 1e-7
        and abs(job.size_arcmin - observation.fov_arcmin) <= 1e-7
        and job.detector == observation.detector
    )
    if not identical or not any(frame.get('status') == 'ready'
                                 for frame in (job.frame_states or [])):
        raise HTTPException(status_code=422, detail='Las imágenes no corresponden a la región publicada')
    return job_id


def validate_reveal(db: Session, job_id: UUID | None,
                    recipe: RevealRecipe | None) -> dict | None:
    if recipe is None:
        return None
    job = db.get(SkySearchJob, job_id) if job_id else None
    if job is None or job.demo or not any(
        state.get("status") == "ready"
        and (state.get("metadata") or {}).get("raw_available")
        for state in (job.frame_states or [])
    ):
        raise HTTPException(status_code=422,
                            detail="Este hallazgo todavía no tiene FITS editables. Realiza una búsqueda nueva.")
    return recipe.model_dump(mode="json")


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
    checked_job = validate_blink_job(db, body.observation_id, body.sky_job_id)
    recipe = validate_reveal(db, checked_job, body.display_recipe)
    post = Post(
        author_id=user.id, caption=body.caption,
        visibility=body.visibility, observation_id=body.observation_id,
        sky_job_id=checked_job, display_recipe=recipe,
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
    return serialize(
        post, username, counts_by_post(db, [post.id]),
        viewer_reposts=reposted_ids(db, viewer, [post.id]),
        viewer_bookmarks=bookmarked_ids(db, viewer, [post.id]),
    )


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
    target_observation = (body.observation_id if 'observation_id' in body.model_fields_set
                          else post.observation_id)
    target_job = post.sky_job_id
    if 'sky_job_id' in body.model_fields_set:
        target_job = validate_blink_job(db, target_observation, body.sky_job_id)
    elif 'observation_id' in body.model_fields_set:
        target_job = None
        post.sky_job_id = None
        post.display_recipe = None
    if 'display_recipe' in body.model_fields_set:
        post.display_recipe = validate_reveal(db, target_job, body.display_recipe)
    elif 'sky_job_id' in body.model_fields_set and target_job != post.sky_job_id:
        post.display_recipe = None
    for key in body.model_fields_set - {'display_recipe'}:
        setattr(post, key, getattr(body, key))
    db.commit()
    db.refresh(post)
    return serialize(
        post, user.username, counts_by_post(db, [post.id]),
        viewer_reposts=reposted_ids(db, user, [post.id]),
        viewer_bookmarks=bookmarked_ids(db, user, [post.id]),
    )


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
    # A profile is one chronologically ordered timeline of authored posts and reposts.
    # The original post remains the sole source of content, likes and SPHEREx frames.
    authored = select(
        Post.id.label('post_id'), Post.created_at.label('activity_at'),
        literal(False).label('is_repost'),
    ).where(Post.author_id == owner.id)
    if viewer is None or viewer.id != owner.id:
        authored = authored.where(Post.visibility == 'public')
    shared = (
        select(
            PostRepost.post_id.label('post_id'),
            PostRepost.created_at.label('activity_at'),
            literal(True).label('is_repost'),
        )
        .join(Post, Post.id == PostRepost.post_id)
        .where(PostRepost.user_id == owner.id, Post.visibility == 'public',
               Post.author_id != owner.id)
    )
    activity = union_all(authored, shared).subquery()
    rows = db.execute(
        select(Post, User.username, activity.c.activity_at, activity.c.is_repost)
        .join(activity, activity.c.post_id == Post.id)
        .join(User, User.id == Post.author_id)
        .order_by(activity.c.activity_at.desc(), Post.id.desc())
        .limit(limit).offset(offset)
    ).all()
    ids = [post.id for post, _, _, _ in rows]
    counts = counts_by_post(db, ids)
    viewer_reposts = reposted_ids(db, viewer, ids)
    viewer_bookmarks = bookmarked_ids(db, viewer, ids)
    return [
        serialize(
            post, author, counts, viewer_reposts=viewer_reposts,
            viewer_bookmarks=viewer_bookmarks,
            reposted_by=owner.username if is_repost else None,
            reposted_at=activity_at if is_repost else None,
        )
        for post, author, activity_at, is_repost in rows
    ]


@router.post('/posts/{post_id}/blink')
def prepare_post_blink(
    post_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
):
    """Lazy, one-time preparation of *real* two-epoch blink images in a post.

    This is an explicit POST because it may create one durable background
    search. Visibility of a post controls access to its preview. We reuse an
    existing compatible sky job rather than resubmitting IRSA requests.
    """
    from persistent_sky import ACTIVE, MAX_ACTIVE_JOBS, _schedule
    from sqlalchemy import func
    from fastapi.responses import JSONResponse

    post = db.scalar(select(Post).where(Post.id == post_id).with_for_update())
    if post is None or (post.visibility == 'private'
                        and (viewer is None or viewer.id != post.author_id)):
        raise HTTPException(status_code=404, detail='Publicación no encontrada')
    if post.observation_id is None:
        raise HTTPException(status_code=404, detail='Esta publicación no tiene una observación')

    observation = db.get(Observation, post.observation_id)
    if observation is None or observation.detector is None:
        raise HTTPException(status_code=404, detail='La observación no está disponible')

    job = db.get(SkySearchJob, post.sky_job_id) if post.sky_job_id else None
    created_id = None
    if job is None:
        job = db.scalar(
            select(SkySearchJob)
            .where(
                SkySearchJob.demo.is_(False),
                SkySearchJob.ra == observation.ra_deg,
                SkySearchJob.dec == observation.dec_deg,
                SkySearchJob.size_arcmin == observation.fov_arcmin,
                SkySearchJob.detector == observation.detector,
                SkySearchJob.status.in_(('queued','catalog','frames','complete','partial','empty')),
            )
            .order_by(SkySearchJob.created_at.desc(), SkySearchJob.id.desc())
            .limit(1)
        )
        if job is None:
            active_count = db.scalar(
                select(func.count()).select_from(SkySearchJob)
                .where(SkySearchJob.status.in_(ACTIVE))
            ) or 0
            if active_count >= MAX_ACTIVE_JOBS:
                raise HTTPException(status_code=429,
                                    detail='Hay otras vistas astronómicas preparándose')
            created_id = uuid4()
            job = SkySearchJob(
                id=created_id,
                ra=observation.ra_deg, dec=observation.dec_deg,
                size_arcmin=observation.fov_arcmin, detector=observation.detector,
                max_frames=2, demo=False, source='sia2',
                status='queued', frame_states=[],
            )
            db.add(job)
            db.flush()
        post.sky_job_id = job.id
        db.commit()

    frame_states = job.frame_states or []
    observation_rows = (job.result_data or {}).get('observations', [])
    by_index = {item['index']: item for item in observation_rows}
    result = {
        'job_id': str(job.id),
        'status': job.status,
        'detector': job.detector,
        'source': job.source,
        'display_recipe': post.display_recipe,
        'frames': [
            {
                'index': item['index'],
                'status': item['status'],
                'date': by_index.get(item['index'], {}).get('date'),
            }
            for item in frame_states
        ],
    }
    if created_id is not None:
        _schedule(created_id)
    return JSONResponse(result, headers={'Cache-Control': 'private, no-store'})
