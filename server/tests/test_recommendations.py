"""Personalized AstroGram feed must remain public, explainable and predictable."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.api import router
from social_api.db import Base, get_db
from social_api.models import Bookmark, Follow, Post, PostHashtag, PostLike, User
from social_api.posts import optional_user


@pytest.fixture()
def scene():
    engine = create_engine(
        "sqlite+pysqlite://", connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    holder = {"viewer_id": None}

    def get_test_db():
        with Session(engine) as db:
            yield db

    def mock_viewer():
        if holder["viewer_id"] is None:
            return None
        with Session(engine) as db:
            return db.get(User, holder["viewer_id"])

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[optional_user] = mock_viewer

    with Session(engine) as db:
        names = ["reader", "followed", "science", "explorer", "busy"]
        people = {
            name: User(username=name, display_name=name,
                       email=name + "@example.invalid", password_hash="none")
            for name in names
        }
        db.add_all(people.values())
        db.flush()
        holder["viewer_id"] = people["reader"].id

        db.add(Follow(follower_id=people["reader"].id,
                      following_id=people["followed"].id))
        timestamp = datetime.now(timezone.utc) - timedelta(hours=2)
        names_authors = [
            ("followed_public", "followed", "New lunar observations", "public"),
            ("tagged_public", "science", "Infrared detection", "public"),
            ("liked_source", "explorer", "My infrared methods", "public"),
            ("hidden_private", "followed", "Very secret infrared", "private"),
            ("hidden_unlisted", "science", "Unlisted infrared", "unlisted"),
            ("unrelated", "explorer", "Different galaxies", "public"),
        ]
        posts = {}
        for label, author, caption, visibility in names_authors:
            post = Post(author_id=people[author].id, caption=caption,
                        visibility=visibility, created_at=timestamp)
            db.add(post)
            db.flush()
            posts[label] = post.id

        db.add_all([
            PostHashtag(post_id=posts["liked_source"], tag="infrared"),
            PostHashtag(post_id=posts["tagged_public"], tag="infrared"),
            PostHashtag(post_id=posts["hidden_private"], tag="infrared"),
            PostHashtag(post_id=posts["hidden_unlisted"], tag="infrared"),
            PostLike(user_id=people["reader"].id,
                     post_id=posts["liked_source"]),
            Bookmark(user_id=people["reader"].id,
                     post_id=posts["liked_source"]),
        ])
        # More posts from the same author to exercise author diversity.
        for i in range(7):
            db.add(Post(author_id=people["busy"].id,
                        caption="Busy author " + str(i),
                        visibility="public", created_at=timestamp))
        db.commit()

    with TestClient(app) as client:
        yield client, holder, posts
    engine.dispose()


def test_for_you_ranks_follows_and_real_tag_interests(scene):
    client, _, posts = scene
    payload = client.get("/v1/feed?mode=for_you&limit=30").json()
    ids = [item["id"] for item in payload]
    assert str(posts["followed_public"]) in ids
    assert str(posts["tagged_public"]) in ids
    assert str(posts["hidden_private"]) not in ids
    assert str(posts["hidden_unlisted"]) not in ids
    item_by_id = {item["id"]: item for item in payload}
    assert item_by_id[str(posts["followed_public"])]["recommended_reason"] == (
        "De un astroamigo que sigues"
    )
    assert item_by_id[str(posts["tagged_public"])]["recommended_reason"] == (
        "Relacionado con #infrared"
    )


def test_following_is_public_only_and_auth_required(scene):
    client, holder, posts = scene
    payload = client.get("/v1/feed?mode=following").json()
    assert [item["id"] for item in payload] == [str(posts["followed_public"])]
    assert payload[0]["recommended_reason"] is None
    holder["viewer_id"] = None
    assert client.get("/v1/feed?mode=following").status_code == 401


def test_cold_start_deterministic_and_author_diversity(scene):
    client, holder, posts = scene
    holder["viewer_id"] = None
    first = client.get("/v1/feed?mode=for_you&limit=10").json()
    again = client.get("/v1/feed?mode=for_you&limit=10").json()
    assert [row["id"] for row in first] == [row["id"] for row in again]
    assert len(set(row["username"] for row in first[:5])) >= 3
    assert all(row["recommended_reason"] for row in first)
    assert str(posts["hidden_private"]) not in [row["id"] for row in first]


def test_recommendation_pages_unique_and_tag_filter_still_chronological(scene):
    client, holder, posts = scene
    first = client.get("/v1/feed?mode=for_you&limit=4&offset=0").json()
    next_page = client.get("/v1/feed?mode=for_you&limit=4&offset=4").json()
    assert set(row["id"] for row in first).isdisjoint(
        row["id"] for row in next_page
    )
    tag = client.get("/v1/feed?mode=for_you&tag=infrared").json()
    assert [row["id"] for row in tag] == [
        str(posts["tagged_public"]), str(posts["liked_source"])
    ] or set(row["id"] for row in tag) == {
        str(posts["tagged_public"]), str(posts["liked_source"])
    }
    assert all(row["recommended_reason"] is None for row in tag)


def test_legacy_feed_is_recent_and_bad_mode_rejected(scene):
    client, _, _ = scene
    recent = client.get("/v1/feed").json()
    assert recent and all(row["recommended_reason"] is None for row in recent)
    assert client.get("/v1/feed?mode=invalid").status_code == 422
