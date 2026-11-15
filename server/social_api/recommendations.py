"""Explainable, bounded AstroGram recommendations; no behavioral tracking.

Features: explicit follows, publicly visible hashtags from likes/bookmarks/
comments/reposts, recentness, capped aggregate engagement, author diversity.
No profiles, reading time, emails, birthday, or private post interactions are
used. A cold-start account falls back to a diverse recent public feed.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Bookmark, Comment, Follow, Post, PostHashtag, PostLike, PostRepost, User,
)
from .posts import counts_by_post

POOL_LIMIT = 300
HISTORY_LIMIT = 100
MAX_INTEREST_TAGS = 12
MAX_AUTHOR_PENALTY = 8.0


def _timestamp(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def viewer_interests(db: Session, viewer: User | None) -> tuple[set[UUID], dict[str, float]]:
    """Only interactions with currently PUBLIC posts supply hashtag affinity."""
    if viewer is None:
        return set(), {}
    followed = set(db.scalars(
        select(Follow.following_id).where(Follow.follower_id == viewer.id)
    ).all())
    signals: dict[UUID, float] = defaultdict(float)
    sources = (
        (PostLike, 1.0), (Bookmark, 2.2),
        (PostRepost, 1.8), (Comment, 1.6),
    )
    for model, weight in sources:
        ids = db.scalars(
            select(model.post_id).where(model.user_id == viewer.id)
            .order_by(model.created_at.desc()).limit(HISTORY_LIMIT)
        ).all() if model is not Comment else db.scalars(
            select(Comment.post_id).where(Comment.author_id == viewer.id)
            .order_by(Comment.created_at.desc()).limit(HISTORY_LIMIT)
        ).all()
        # Repeated comments on the same post aren't independent interests.
        for post_id in set(ids):
            signals[post_id] += weight

    if not signals:
        return followed, {}
    eligible = set(db.scalars(
        select(Post.id).where(
            Post.id.in_(list(signals)), Post.visibility == "public",
            Post.author_id != viewer.id,
        )
    ).all())
    if not eligible:
        return followed, {}
    weights: dict[str, float] = defaultdict(float)
    for post_id, tag in db.execute(
        select(PostHashtag.post_id, PostHashtag.tag)
        .where(PostHashtag.post_id.in_(list(eligible)))
    ):
        weights[tag] += signals[post_id]
    # Clip both the number of interests and the influence of a single topic.
    ranked = sorted(weights.items(), key=lambda item: (-item[1], item[0]))
    return followed, {tag: min(5.0, weight) for tag, weight in ranked[:MAX_INTEREST_TAGS]}


def recommended_rows(db: Session, viewer: User | None, limit: int, offset: int
                     ) -> list[tuple[Post, str, str]]:
    """Rank one fixed, bounded recent window, THEN paginate it.

    Stable tie-breaking prevents duplicates across pages when the underlying
    dataset is unchanged. New activity may change ranks between independent
    HTTP requests; the client deduplicates IDs during infinite scrolling.
    """
    if offset >= POOL_LIMIT:
        return []
    rows = db.execute(
        select(Post, User.username)
        .join(User, User.id == Post.author_id)
        .where(Post.visibility == "public")
        .order_by(Post.created_at.desc(), Post.id.desc())
        .limit(POOL_LIMIT)
    ).all()
    if not rows:
        return []

    followed, interests = viewer_interests(db, viewer)
    ids = [post.id for post, _ in rows]
    counts = counts_by_post(db, ids)
    all_tags: dict[UUID, list[str]] = defaultdict(list)
    for post_id, tag in db.execute(
        select(PostHashtag.post_id, PostHashtag.tag)
        .where(PostHashtag.post_id.in_(ids))
    ):
        all_tags[post_id].append(tag)

    now = datetime.now(timezone.utc)
    ranked: list[tuple[Post, str, str, float]] = []
    for post, username in rows:
        hours = max(0.0, (now - _timestamp(post.created_at)).total_seconds() / 3600)
        freshness = 6.0 * math.exp(-hours / (24.0 * 7))
        likes, comments, reposts = counts.get(post.id, (0, 0, 0))
        interactions = likes + 1.5 * comments + 2.0 * reposts
        popularity = min(3.3, 0.85 * math.log1p(interactions))
        is_followed = post.author_id in followed
        shared = [(tag, interests[tag]) for tag in all_tags[post.id] if tag in interests]
        shared.sort(key=lambda t: (-t[1], t[0]))
        matching = min(4.5, sum(weight * 0.85 for _, weight in shared))
        score = freshness + popularity + matching + (3.8 if is_followed else 0)
        if viewer is not None and post.author_id == viewer.id:
            score -= 1.4

        # Explanations describe actual signals; never imply knowledge of beliefs
        # or interests when the account is new.
        if is_followed:
            reason = "De un astroamigo que sigues"
        elif shared:
            reason = "Relacionado con #" + shared[0][0]
        elif popularity >= 2.1:
            reason = "Popular en la comunidad"
        else:
            reason = "Reciente en AstroGram"
        ranked.append((post, username, reason, score))

    # Penalize repeated authors to surface different voices. Process the full
    # bounded window before pagination so results are deterministic for a
    # stable database snapshot and a stable set of viewer signals.
    selected: list[tuple[Post, str, str]] = []
    seen_authors: Counter[UUID] = Counter()
    while ranked:
        best_i = min(
            range(len(ranked)),
            key=lambda i: (
                -(ranked[i][3] - min(
                    MAX_AUTHOR_PENALTY, 2.3 * seen_authors[ranked[i][0].author_id]
                )),
                -_timestamp(ranked[i][0].created_at).timestamp(),
                str(ranked[i][0].id),
            ),
        )
        post, username, reason, _ = ranked.pop(best_i)
        selected.append((post, username, reason))
        seen_authors[post.author_id] += 1
    return selected[offset:offset + limit]
