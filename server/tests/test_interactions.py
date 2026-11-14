"""Sprint 3 integration tests: visibility, idempotency, and ownership."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.auth import _create_access_token
from social_api.db import Base, get_db
from social_api.main import create_app
from social_api.models import User


@pytest.fixture
def env():
    engine = create_engine(
        'sqlite+pysqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, 'connect')
    def enforce_foreign_keys(dbapi_connection, _):
        dbapi_connection.execute('PRAGMA foreign_keys=ON')

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        alpha = User(username='alpha', display_name='Alpha', email='alpha@example.invalid',
                     password_hash='test-only')
        beta = User(username='beta', display_name='Beta', email='beta@example.invalid',
                    password_hash='test-only')
        gamma = User(username='gamma', display_name='Gamma', email='gamma@example.invalid',
                     password_hash='test-only')
        db.add_all([alpha, beta, gamma])
        db.commit()
        for user in (alpha, beta, gamma):
            db.refresh(user)
        headers = {
            user.username: {'Authorization': f'Bearer {_create_access_token(user).access_token}'}
            for user in (alpha, beta, gamma)
        }

    app = create_app()

    def get_test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = get_test_db
    try:
        with TestClient(app) as client:
            yield client, headers
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def new_post(client, headers, visibility='public', caption='Changing sky'):
    result = client.post('/v1/posts', headers=headers['alpha'], json={
        'caption': caption, 'visibility': visibility,
    })
    assert result.status_code == 201, result.text
    return result.json()['id']


def test_likes_idempotent_and_counts_on_feed_and_detail(env):
    client, headers = env
    post_id = new_post(client, headers)
    like_url = f'/v1/posts/{post_id}/like'
    assert client.post(like_url).status_code == 401
    assert client.post(like_url, headers=headers['beta']).status_code == 204
    assert client.post(like_url, headers=headers['beta']).status_code == 204
    assert client.post(like_url, headers=headers['gamma']).status_code == 204
    item = client.get(f'/v1/posts/{post_id}').json()
    assert item['likes_count'] == 2 and item['comments_count'] == 0
    assert client.get('/v1/feed').json()[0]['likes_count'] == 2
    assert client.get('/v1/users/alpha/posts').json()[0]['likes_count'] == 2
    assert client.delete(like_url, headers=headers['beta']).status_code == 204
    assert client.delete(like_url, headers=headers['beta']).status_code == 204
    assert client.get(f'/v1/posts/{post_id}').json()['likes_count'] == 1


def test_bookmarks_are_private_and_idempotent(env):
    client, headers = env
    public = new_post(client, headers, 'public', 'public')
    unlisted = new_post(client, headers, 'unlisted', 'unlisted')
    secret = new_post(client, headers, 'private', 'secret')
    url = f'/v1/posts/{public}/bookmark'
    assert client.post(url).status_code == 401
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{unlisted}/bookmark', headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{secret}/bookmark', headers=headers['beta']).status_code == 404
    assert client.get('/v1/users/me/bookmarks').status_code == 401
    saved_beta = client.get('/v1/users/me/bookmarks', headers=headers['beta']).json()
    assert {p['id'] for p in saved_beta} == {public, unlisted}
    assert client.get('/v1/users/me/bookmarks', headers=headers['alpha']).json() == []
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert [p['id'] for p in client.get('/v1/users/me/bookmarks', headers=headers['beta']).json()] == [unlisted]
    # If a formerly public post turns private, other users cannot see it in saved items.
    assert client.patch(f'/v1/posts/{unlisted}', headers=headers['alpha'],
                        json={'visibility': 'private'}).status_code == 200
    assert client.get('/v1/users/me/bookmarks', headers=headers['beta']).json() == []


def test_comments_replies_validation_and_counters(env):
    client, headers = env
    post_id = new_post(client, headers)
    other_post_id = new_post(client, headers, caption='Other post')
    url = f'/v1/posts/{post_id}/comments'
    assert client.post(url, json={'body': 'Unverified'}).status_code == 401
    assert client.post(url, headers=headers['beta'], json={'body': '  '}).status_code == 422
    assert client.post(url, headers=headers['beta'], json={'body': 'x' * 2001}).status_code == 422
    assert client.post(url, headers=headers['beta'], json={'body': 'Hello', 'unknown': 2}).status_code == 422
    root = client.post(url, headers=headers['beta'], json={'body': '  I see a change  '})
    assert root.status_code == 201, root.text
    root_id = root.json()['id']
    assert root.json()['username'] == 'beta'
    assert root.json()['body'] == 'I see a change'
    reply = client.post(url, headers=headers['gamma'], json={
        'body': 'I can confirm', 'parent_id': root_id,
    })
    assert reply.status_code == 201
    assert reply.json()['parent_id'] == root_id
    invalid_reply = client.post(f'/v1/posts/{other_post_id}/comments', headers=headers['gamma'],
                                json={'body': 'wrong tree', 'parent_id': root_id})
    assert invalid_reply.status_code == 404
    read = client.get(url)
    assert read.status_code == 200
    assert [item['body'] for item in read.json()] == ['I see a change', 'I can confirm']
    assert client.get(url + '?limit=1').json()[0]['id'] == root_id
    assert client.get(url + '?limit=0').status_code == 422
    assert client.get(f'/v1/posts/{post_id}').json()['comments_count'] == 2
    assert client.get('/v1/feed').json()[0 if client.get('/v1/feed').json()[0]['id'] == post_id else 1]['comments_count'] == 2


def test_comment_delete_permissions_and_cascade(env):
    client, headers = env
    post_id = new_post(client, headers)
    url = f'/v1/posts/{post_id}/comments'
    root_id = client.post(url, headers=headers['beta'], json={'body': 'Root'}).json()['id']
    reply_id = client.post(url, headers=headers['gamma'],
                           json={'body': 'Reply', 'parent_id': root_id}).json()['id']
    deletion = f'{url}/{root_id}'
    assert client.delete(deletion).status_code == 401
    assert client.delete(deletion, headers=headers['gamma']).status_code == 403
    assert client.delete(f'{url}/{uuid.uuid4()}', headers=headers['alpha']).status_code == 404
    assert client.delete(deletion, headers=headers['alpha']).status_code == 204
    assert client.get(url).json() == []
    assert client.get(f'/v1/posts/{post_id}').json()['comments_count'] == 0
    assert client.delete(f'{url}/{reply_id}', headers=headers['gamma']).status_code == 404


def test_follows_counts_and_self_follow_block(env):
    client, headers = env
    url = '/v1/users/alpha/follow'
    assert client.post(url).status_code == 401
    assert client.post(url, headers=headers['alpha']).status_code == 400
    assert client.post('/v1/users/absent/follow', headers=headers['beta']).status_code == 404
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['gamma']).status_code == 204
    stats = client.get('/v1/users/alpha/stats').json()
    assert stats == {'username': 'alpha', 'followers_count': 2,
                     'following_count': 0, 'is_following': False}
    assert client.get('/v1/users/alpha/stats', headers=headers['beta']).json()['is_following']
    assert client.get('/v1/users/beta/stats').json()['following_count'] == 1
    assert client.get('/v1/users/absent/stats').status_code == 404
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.get('/v1/users/alpha/stats').json()['followers_count'] == 1
    assert not client.get('/v1/users/alpha/stats', headers=headers['beta']).json()['is_following']


def test_private_posts_protect_interactions(env):
    client, headers = env
    private = new_post(client, headers, visibility='private')
    unlisted = new_post(client, headers, visibility='unlisted')
    for kind in ('like', 'bookmark'):
        assert client.post(f'/v1/posts/{private}/{kind}', headers=headers['beta']).status_code == 404
        assert client.post(f'/v1/posts/{private}/{kind}', headers=headers['alpha']).status_code == 204
        assert client.post(f'/v1/posts/{unlisted}/{kind}', headers=headers['beta']).status_code == 204
    assert client.get(f'/v1/posts/{private}/comments').status_code == 404
    assert client.post(f'/v1/posts/{private}/comments', headers=headers['beta'],
                       json={'body': 'Nope'}).status_code == 404
    assert client.get(f'/v1/posts/{private}/comments', headers=headers['alpha']).status_code == 200
    assert client.post(f'/v1/posts/{unlisted}/comments', headers=headers['beta'],
                       json={'body': 'By direct link'}).status_code == 201
    assert client.get(f'/v1/posts/{unlisted}/comments').json()[0]['body'] == 'By direct link'
    assert client.get(f'/v1/posts/{unlisted}').json()['likes_count'] == 1
    assert client.get('/v1/feed').json() == []
    assert client.get('/v1/users/me/bookmarks', headers=headers['alpha']).json()[0]['id'] == private


def test_combined_app_has_new_routes():
    from app import app
    paths = app.openapi()['paths']
    for endpoint in (
        '/v1/posts/{post_id}/like', '/v1/posts/{post_id}/bookmark',
        '/v1/posts/{post_id}/comments', '/v1/posts/{post_id}/comments/{comment_id}',
        '/v1/users/{username}/follow', '/v1/users/{username}/stats',
        '/v1/users/me/bookmarks',
    ):
        assert endpoint in paths
