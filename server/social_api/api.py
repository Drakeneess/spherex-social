"""Read-only operational, feed and observation endpoints."""
from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from .db import get_db
from .models import Observation, Post, User
from .posts import PostOut

router = APIRouter(prefix='/v1', tags=['social'])


class ObservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    ra_deg: float
    dec_deg: float
    fov_arcmin: float
    detector: int | None
    mission: str
    data_release: str | None
    created_at: datetime


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
):
    # Chronological public feed: personalization comes later.
    rows = db.execute(
        select(Post, User.username)
        .join(User, Post.author_id == User.id)
        .where(Post.visibility == 'public')
        .order_by(Post.created_at.desc(), Post.id.desc())
        .limit(limit).offset(offset)
    ).all()
    return [PostOut(id=p.id, username=username, caption=p.caption,
                    observation_id=p.observation_id, visibility=p.visibility,
                    created_at=p.created_at)
            for p, username in rows]


@router.get('/observations/{observation_id}', response_model=ObservationOut)
def get_observation(observation_id: UUID, db: Session = Depends(get_db)):
    observation = db.get(Observation, observation_id)
    if observation is None:
        raise HTTPException(status_code=404, detail='Observation not found')
    return observation
