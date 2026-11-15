"""Public-only search contract, ranking, literal matching and pagination."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.db import Base, get_db
from social_api.models import Post, PostHashtag, User
from social_api.search import router


@pytest.fixture
def client():
    engine = create_engine("sqlite+pysqlite://",
                           connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def db_override():
        with Session(engine) as db:
            yield db

    application = FastAPI()
    application.include_router(router)
    application.dependency_overrides[get_db] = db_override

    with Session(engine) as db:
        users = [
            User(username="astrofan", display_name="Sol Luminous",
                 email="astrofan@example.invalid", password_hash="private-hash",
                 bio="Observadora de estrellas"),
            User(username="solaria", display_name="Astro Fanático",
                 email="solaria@example.invalid", password_hash="private-hash",
                 bio="Mi nota privada no debe filtrarse a búsquedas irrelevantes"),
            User(username="cosmos", display_name="Sistemas",
                 email="cosmos@example.invalid", password_hash="private-hash"),
        ]
        db.add_all(users)
        db.flush()
        now = datetime(2026, 10, 1, tzinfo=timezone.utc)
        posts = [
            Post(author_id=users[0].id, caption="Nebulosa de Orión #astrofoto",
                 visibility="public", created_at=now),
            Post(author_id=users[1].id, caption="Señal interesante de #astrofoto",
                 visibility="public", created_at=now-timedelta(days=1)),
            Post(author_id=users[0].id, caption="Foto personal de nebulosa",
                 visibility="private", created_at=now),
            Post(author_id=users[0].id, caption="Nebulosa sin enlace",
                 visibility="unlisted", created_at=now),
            Post(author_id=users[2].id, caption="Mi otra galaxia",
                 visibility="public", created_at=now),
            Post(author_id=users[2].id, caption="astro_fotografia instrumental",
                 visibility="public", created_at=now),
        ]
        db.add_all(posts)
        db.flush()
        db.add_all([
            PostHashtag(post_id=posts[0].id, tag="astrofoto"),
            PostHashtag(post_id=posts[1].id, tag="astrofoto"),
            PostHashtag(post_id=posts[2].id, tag="oculto"),
        ])
        db.commit()

    with TestClient(application) as test_client:
        yield test_client

    engine.dispose()


def test_exact_username_first_and_not_private_metadata(client):
    response = client.get("/v1/search", params={"q": "astro", "limit": 10})
    assert response.status_code == 200, response.text
    data = response.json()
    assert [u["username"] for u in data["users"]] == ["astrofan", "solaria"]
    for user in data["users"]:
        assert "email" not in user
        assert "password_hash" not in user
        assert "birth_date" not in user
    exact = client.get("/v1/search", params={"q": "@ASTROFAN"}).json()
    assert exact["users"][0]["username"] == "astrofan"
    assert exact["posts"] == []
    assert exact["hashtags"] == []


def test_post_search_excludes_unlisted_and_private(client):
    data = client.get("/v1/search", params={"q": "nebulosa"}).json()
    assert [p["caption"] for p in data["posts"]] == ["Nebulosa de Orión #astrofoto"]
    assert data["hashtags"] == []


def test_hashtags_only_count_public_posts(client):
    data = client.get("/v1/search", params={"q": "#astrofoto"}).json()
    assert data["users"] == []
    assert data["hashtags"] == [{"tag":"astrofoto","posts_count":2}]
    assert len(data["posts"]) == 2
    hidden = client.get("/v1/search", params={"q": "#oculto"}).json()
    assert hidden["hashtags"] == []
    assert hidden["posts"] == []


def test_wildcards_are_literal_and_short_queries_are_skipped(client):
    # "_" is a SQL wildcard without explicit escaping; "astro_f" must be literal.
    data = client.get("/v1/search", params={"q": "astro_f"}).json()
    assert [p["caption"] for p in data["posts"]] == ["astro_fotografia instrumental"]
    assert client.get("/v1/search", params={"q": "%_"}).json()["posts"] == []
    short = client.get("/v1/search", params={"q": "x"}).json()
    assert not short["users"] and not short["posts"] and not short["hashtags"]


def test_pagination_and_input_limits(client):
    first = client.get("/v1/search", params={"q": "#astrofoto", "limit": 1}).json()
    assert len(first["posts"]) == 1
    assert first["more_posts"]
    second = client.get("/v1/search", params={"q": "#astrofoto", "limit": 1, "offset": 1}).json()
    assert len(second["posts"]) == 1
    assert not second["more_posts"]
    assert second["posts"][0]["id"] != first["posts"][0]["id"]
    assert client.get("/v1/search", params={"q": "a"*81}).status_code == 422
    assert client.get("/v1/search", params={"q": "astro", "limit": 101}).status_code == 422
