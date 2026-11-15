"""Relational social domain and astronomy data provenance.

Scientific image data belongs in object storage, not in PostgreSQL bytea fields.
"""
import uuid
from datetime import date, datetime, timezone
from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, JSON,
    SmallInteger, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid
from .db import Base


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = 'users'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    website: Mapped[str | None] = mapped_column(String(300), nullable=True)
    avatar_version: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    cover_version: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    avatar_color_start: Mapped[str | None] = mapped_column(String(7), nullable=True)
    avatar_color_end: Mapped[str | None] = mapped_column(String(7), nullable=True)
    cover_color_start: Mapped[str | None] = mapped_column(String(7), nullable=True)
    cover_color_end: Mapped[str | None] = mapped_column(String(7), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    show_birthday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (CheckConstraint("length(username) >= 3", name='ck_users_username_length'),)

    @property
    def birthday_public(self) -> str | None:
        """Only month/day may be shared, on explicit opt-in; never expose year."""
        if not self.show_birthday or self.birth_date is None:
            return None
        return f'{self.birth_date.month:02d}-{self.birth_date.day:02d}'


class AuthSession(Base):
    """Revocable per-device login session; only SHA-256 of secret is stored."""
    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    secret_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Follow(Base):
    __tablename__ = 'follows'
    follower_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    following_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (CheckConstraint('follower_id <> following_id', name='ck_follows_not_self'),)


class Observation(Base):
    __tablename__ = 'observations'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    creator_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    ra_deg: Mapped[float] = mapped_column(Float, nullable=False)
    dec_deg: Mapped[float] = mapped_column(Float, nullable=False)
    fov_arcmin: Mapped[float] = mapped_column(Float, nullable=False)
    detector: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    mission: Mapped[str] = mapped_column(String(30), server_default='SPHEREx', nullable=False)
    data_release: Mapped[str | None] = mapped_column(String(32), nullable=True)
    processing_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (
        CheckConstraint('ra_deg >= 0 AND ra_deg < 360', name='ck_observation_ra'),
        CheckConstraint('dec_deg >= -90 AND dec_deg <= 90', name='ck_observation_dec'),
        CheckConstraint('fov_arcmin > 0 AND fov_arcmin <= 120', name='ck_observation_fov'),
        CheckConstraint('detector IS NULL OR detector BETWEEN 1 AND 6', name='ck_observation_detector'),
        Index('ix_observations_created_at', 'created_at'),
    )


class ObservationFrame(Base):
    __tablename__ = 'observation_frames'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    observation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('observations.id', ondelete='CASCADE'), nullable=False, index=True)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_uri: Mapped[str] = mapped_column(Text, nullable=False)
    product_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    wavelength_um: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_flags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Post(Base):
    __tablename__ = 'posts'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    observation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey('observations.id', ondelete='SET NULL'), nullable=True, index=True)
    sky_job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('sky_search_jobs.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    caption: Mapped[str] = mapped_column(Text, nullable=False)
    # Immutable-at-publication visual recipe; original FITS stay independent.
    display_recipe: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), server_default='public', nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (
        CheckConstraint("visibility IN ('public','unlisted','private')", name='ck_posts_visibility'),
        Index('ix_posts_visibility_created', 'visibility', 'created_at'),
    )


class PostMedia(Base):
    __tablename__ = 'post_media'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    post_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    media_type: Mapped[str] = mapped_column(String(40), nullable=False)
    position: Mapped[int] = mapped_column(Integer, server_default='0', nullable=False)
    __table_args__ = (UniqueConstraint('post_id', 'position', name='uq_media_position'),)


class PostHashtag(Base):
    __tablename__ = 'post_hashtags'
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True)
    tag: Mapped[str] = mapped_column(String(30), primary_key=True)
    __table_args__ = (Index('ix_post_hashtags_tag', 'tag'),)


class Notification(Base):
    """Private, durable social event for one recipient.

    Cascading foreign keys hide deleted users/posts/comments rather than
    leaving stale links or exposing content after it disappears.
    """
    __tablename__ = 'notifications'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    event_key: Mapped[str] = mapped_column(String(180), nullable=False, unique=True)
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), nullable=True)
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('comments.id', ondelete='CASCADE'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        CheckConstraint("kind IN ('like','comment','reply','repost','follow')",
                        name='ck_notifications_kind'),
        CheckConstraint('recipient_id <> actor_id', name='ck_notifications_not_self'),
        Index('ix_notifications_recipient_created', 'recipient_id', 'created_at'),
        Index('ix_notifications_recipient_unread', 'recipient_id', 'read_at'),
    )


class PostLike(Base):
    __tablename__ = 'post_likes'
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PostRepost(Base):
    """A profile reshares the original public post, preserving its interactions."""
    __tablename__ = 'post_reposts'
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True,
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    __table_args__ = (Index('ix_post_reposts_post_id', 'post_id'),)


class Bookmark(Base):
    __tablename__ = 'bookmarks'
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Comment(Base):
    __tablename__ = 'comments'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    post_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey('comments.id', ondelete='CASCADE'), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ProcessingJob(Base):
    __tablename__ = 'processing_jobs'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    observation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey('observations.id', ondelete='CASCADE'), nullable=False, index=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    status: Mapped[str] = mapped_column(String(16), server_default='pending', nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (CheckConstraint("status IN ('pending','running','success','failed')", name='ck_jobs_status'),)


class SkySearchJob(Base):
    """Durable sky exploration, independent of short-lived login tokens.

    Catalog data and per-frame status live in PostgreSQL. Rendered PNGs live
    in S3 object storage, never in database BYTEA or process-local memory.
    The random UUID is a capability: do not store account secrets here.
    """

    __tablename__ = 'sky_search_jobs'
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    ra: Mapped[float] = mapped_column(Float, nullable=False)
    dec: Mapped[float] = mapped_column(Float, nullable=False)
    size_arcmin: Mapped[float] = mapped_column(Float, nullable=False)
    detector: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    max_frames: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='false')
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default='queued')
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default='sia2')
    total_matches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    records_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    frame_states: Mapped[list | None] = mapped_column(JSON, nullable=True)
    discovery_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint('ra >= 0 AND ra < 360', name='ck_sky_search_ra'),
        CheckConstraint('dec BETWEEN -90 AND 90', name='ck_sky_search_dec'),
        CheckConstraint('size_arcmin BETWEEN 1 AND 12', name='ck_sky_search_size'),
        CheckConstraint('detector BETWEEN 1 AND 6', name='ck_sky_search_detector'),
        CheckConstraint('max_frames BETWEEN 2 AND 16', name='ck_sky_search_frames'),
        CheckConstraint(
            "status IN ('queued','catalog','frames','complete','partial','empty','failed','cancelled')",
            name='ck_sky_search_status',
        ),
        Index('ix_sky_search_status_lease', 'status', 'lease_until'),
    )
