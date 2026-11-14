"""Post CRUD, visibility, authorization and observation-link tests."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.auth import _create_access_token
from social_api.db import Base, get_db
from social_api.main import create_app
from social_api.models import Observation, Post, User


@pytest.fixture
def env():
    engine = create_engine(
        'sqlite+pysqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = User(username='alpha', display_name='Alpha', email='alpha@example.invalid',
                     password_hash='not-used-in-these-tests')
        second = User(username='beta', display_name='Beta', email='beta@example.invalid',
                      password_hash='not-used-in-these-tests')
        db.add_all([first, second])
        db.commit()
        db.refresh(first)
        db.refresh(second)
        first_id, second_id = first.id, second.id
        token_a, token_b = _create_access_token(first).access_token, _create_access_token(second).access_token

    app = create_app()
    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client, engine, first_id, second_id, {
                'alpha': {'Authorization': f'Bearer {token_a}'},
                'beta': {'Authorization': f'Bearer {token_b}'},
            }
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def publish(client, headers, caption='Astronomical observation', **changes):
    return client.post('/v1/posts', headers=headers, json={'caption': caption, **changes})


def test_create_read_edit_delete_and_permissions(env):
    client, _, _, _, headers = env
    assert publish(client, {}).status_code == 401
    created = publish(client, headers['alpha'], 'First light')
    assert created.status_code == 201, created.text
    post = created.json()
    assert post['username'] == 'alpha'
    assert post['caption'] == 'First light'
    assert post['visibility'] == 'public'
    assert post['observation_id'] is None
    post_id = post['id']
    assert client.get(f'/v1/posts/{post_id}').status_code == 200
    assert client.get('/v1/feed').json()[0]['id'] == post_id

    assert client.patch(f'/v1/posts/{post_id}', json={'caption': 'stolen'},
                        headers=headers['beta']).status_code == 404
    assert client.delete(f'/v1/posts/{post_id}', headers=headers['beta']).status_code == 404
    assert client.patch(f'/v1/posts/{post_id}', json={'caption': 'x'}).status_code == 401
    changed = client.patch(f'/v1/posts/{post_id}', json={'caption': '  Updated  '},
                           headers=headers['alpha'])
    assert changed.status_code == 200
    assert changed.json()['caption'] == 'Updated'
    assert client.get(f'/v1/posts/{post_id}').json()['caption'] == 'Updated'
    deleted = client.delete(f'/v1/posts/{post_id}', headers=headers['alpha'])
    assert deleted.status_code == 204 and deleted.content == b''
    assert client.get(f'/v1/posts/{post_id}').status_code == 404
    assert client.delete(f'/v1/posts/{post_id}', headers=headers['alpha']).status_code == 404


def test_visibility_is_enforced_on_feed_and_profiles(env):
    client, _, _, _, headers = env
    public = publish(client, headers['alpha'], 'Public').json()['id']
    unlisted = publish(client, headers['alpha'], 'Unlisted', visibility='unlisted').json()['id']
    private = publish(client, headers['alpha'], 'Private', visibility='private').json()['id']

    assert [p['id'] for p in client.get('/v1/feed').json()] == [public]
    assert client.get(f'/v1/posts/{public}').status_code == 200
    assert client.get(f'/v1/posts/{unlisted}').status_code == 200
    assert client.get(f'/v1/posts/{private}').status_code == 404
    assert client.get(f'/v1/posts/{private}', headers=headers['beta']).status_code == 404
    assert client.get(f'/v1/posts/{private}', headers=headers['alpha']).status_code == 200
    assert client.get(f'/v1/posts/{private}',
                      headers={'Authorization': 'Bearer garbage'}).status_code == 401

    assert {p['id'] for p in client.get('/v1/users/alpha/posts').json()} == {public}
    assert {p['id'] for p in client.get('/v1/users/alpha/posts',
                                     headers=headers['beta']).json()} == {public}
    assert {p['id'] for p in client.get('/v1/users/alpha/posts',
                                     headers=headers['alpha']).json()} == {public, unlisted, private}
    assert client.get('/v1/users/nobody/posts').status_code == 404
    assert client.get('/v1/users/alpha/posts?limit=0').status_code == 422


def test_validation_and_observation_reference(env):
    client, engine, first_id, _, headers = env
    missing = str(uuid4())
    assert publish(client, headers['alpha'], '   ').status_code == 422
    assert publish(client, headers['alpha'], 'x' * 3001).status_code == 422
    assert publish(client, headers['alpha'], 'Text', visibility='friends').status_code == 422
    assert publish(client, headers['alpha'], 'Text', unknown_field='x').status_code == 422
    assert publish(client, headers['alpha'], 'Text', observation_id=missing).status_code == 404
    with Session(engine) as db:
        observation = Observation(creator_id=first_id, ra_deg=133.795, dec_deg=-7.245,
                                  fov_arcmin=6, detector=2, data_release='DR1')
        db.add(observation)
        db.commit()
        db.refresh(observation)
        observation_id = str(observation.id)

    created = publish(client, headers['alpha'], 'With observation',
                      observation_id=observation_id)
    assert created.status_code == 201
    post_id = created.json()['id']
    assert created.json()['observation_id'] == observation_id
    assert client.patch(f'/v1/posts/{post_id}', headers=headers['alpha'],
                        json={'caption': None}).status_code == 422
    assert client.patch(f'/v1/posts/{post_id}', headers=headers['alpha'],
                        json={'visibility': None}).status_code == 422
    assert client.patch(f'/v1/posts/{post_id}', headers=headers['alpha'],
                        json={'observation_id': missing}).status_code == 404
    assert client.get(f'/v1/posts/{post_id}').json()['observation_id'] == observation_id
    cleared = client.patch(f'/v1/posts/{post_id}', headers=headers['alpha'],
                           json={'observation_id': None, 'visibility': 'private'})
    assert cleared.status_code == 200
    assert cleared.json()['observation_id'] is None
    assert client.get(f'/v1/posts/{post_id}').status_code == 404


def test_feed_pagination_and_visibility_change(env):
    client, engine, _, _, headers = env
    ids = [publish(client, headers['alpha'], f'Post {i}').json()['id'] for i in range(4)]
    with Session(engine) as db:
        for i, post_id in enumerate(ids):
            post = db.get(Post, UUID(post_id))
            post.created_at = datetime(2026, 11, 14, tzinfo=timezone.utc) + timedelta(minutes=i)
        db.commit()
    first = client.get('/v1/feed?limit=2').json()
    second = client.get('/v1/feed?limit=2&offset=2').json()
    assert [p['id'] for p in first] == ids[::-1][:2]
    assert [p['id'] for p in second] == ids[::-1][2:]
    assert client.get('/v1/feed?limit=51').status_code == 422
    assert client.patch(f'/v1/posts/{ids[-1]}', headers=headers['alpha'],
                        json={'visibility': 'private'}).status_code == 200
    assert ids[-1] not in [p['id'] for p in client.get('/v1/feed').json()]
