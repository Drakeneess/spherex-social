"""Persisted sky regions, independent of temporary IRSA image sessions.

An observation record stores *search parameters*; it does not assert that
SPHEREx images have been downloaded, checked or scientifically validated.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import Observation, Post, User
from .posts import PostOut, counts_by_post, optional_user, serialize

router = APIRouter(prefix='/v1', tags=['observations'])


class ObservationCreate(BaseModel):
    """A user-selected sky position, not an asserted IRSA image product."""
    model_config = ConfigDict(extra='forbid')
    ra_deg: float = Field(ge=0, lt=360, allow_inf_nan=False)
    dec_deg: float = Field(ge=-90, le=90, allow_inf_nan=False)
    fov_arcmin: float = Field(ge=1, le=12, allow_inf_nan=False)
    detector: int = Field(ge=1, le=6)


class ObservationOut(BaseModel):
    id: UUID
    ra_deg: float
    dec_deg: float
    fov_arcmin: float
    detector: int | None
    mission: str
    data_release: str | None
    created_at: datetime
    viewer_path: str


def serialize_observation(observation: Observation) -> ObservationOut:
    return ObservationOut(
        id=observation.id,
        ra_deg=observation.ra_deg,
        dec_deg=observation.dec_deg,
        fov_arcmin=observation.fov_arcmin,
        detector=observation.detector,
        mission=observation.mission,
        data_release=observation.data_release,
        created_at=observation.created_at,
        viewer_path=f'/?observation_id={observation.id}',
    )


def require_observation(db: Session, observation_id: UUID) -> Observation:
    observation = db.get(Observation, observation_id)
    if observation is None:
        raise HTTPException(status_code=404, detail='Observation not found')
    return observation


@router.post('/observations', response_model=ObservationOut, status_code=status.HTTP_201_CREATED)
def create_observation(
    body: ObservationCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    # Do not accept a client-supplied data_release: that requires verifying
    # an actual source product. Processing and frames belong in a later sprint.
    observation = Observation(
        creator_id=user.id, ra_deg=body.ra_deg, dec_deg=body.dec_deg,
        fov_arcmin=body.fov_arcmin, detector=body.detector, mission='SPHEREx',
        data_release=None,
    )
    db.add(observation)
    db.commit()
    db.refresh(observation)
    return serialize_observation(observation)


@router.get('/observations', response_model=list[ObservationOut])
def search_observations(
    db: Annotated[Session, Depends(get_db)],
    ra_deg: float | None = Query(None, ge=0, lt=360, allow_inf_nan=False),
    dec_deg: float | None = Query(None, ge=-90, le=90, allow_inf_nan=False),
    radius_arcmin: float = Query(30, ge=0.1, le=120, allow_inf_nan=False),
    detector: int | None = Query(None, ge=1, le=6),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    """List saved regions, or find them within a true angular separation.

    Uses spherical cosine law in PostgreSQL (also available in current
    SQLite builds for CI). The query never calls IRSA.
    """
    if (ra_deg is None) != (dec_deg is None):
        raise HTTPException(status_code=422, detail='ra_deg and dec_deg must be provided together')
    stmt = select(Observation)
    if ra_deg is not None and dec_deg is not None:
        target_dec = math.radians(dec_deg)
        other_dec = func.radians(Observation.dec_deg)
        cos_sep = (
            math.sin(target_dec) * func.sin(other_dec)
            + math.cos(target_dec) * func.cos(other_dec)
            * func.cos(func.radians(Observation.ra_deg - ra_deg))
        )
        stmt = stmt.where(cos_sep >= math.cos(math.radians(radius_arcmin / 60)) - 1e-12)
    if detector is not None:
        stmt = stmt.where(Observation.detector == detector)
    records = db.scalars(
        stmt.order_by(Observation.created_at.desc(), Observation.id.desc())
        .limit(limit).offset(offset)
    ).all()
    return [serialize_observation(record) for record in records]


@router.get('/users/me/observations', response_model=list[ObservationOut])
def my_observations(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    records = db.scalars(
        select(Observation)
        .where(Observation.creator_id == user.id)
        .order_by(Observation.created_at.desc(), Observation.id.desc())
        .limit(limit).offset(offset)
    ).all()
    return [serialize_observation(record) for record in records]


@router.get('/observations/{observation_id}', response_model=ObservationOut)
def get_observation(
    observation_id: UUID,
    db: Annotated[Session, Depends(get_db)],
):
    return serialize_observation(require_observation(db, observation_id))


@router.get('/observations/{observation_id}/posts', response_model=list[PostOut])
def observation_posts(
    observation_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    viewer: Annotated[User | None, Depends(optional_user)],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10000),
):
    require_observation(db, observation_id)
    stmt = (
        select(Post, User.username)
        .join(User, Post.author_id == User.id)
        .where(Post.observation_id == observation_id)
    )
    if viewer is None:
        stmt = stmt.where(Post.visibility == 'public')
    else:
        stmt = stmt.where(or_(Post.visibility == 'public', Post.author_id == viewer.id))
    rows = db.execute(
        stmt.order_by(Post.created_at.desc(), Post.id.desc())
        .limit(limit).offset(offset)
    ).all()
    counts = counts_by_post(db, [post.id for post, _ in rows])
    return [serialize(post, username, counts) for post, username in rows]
