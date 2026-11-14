"""Sprint 4: persisted sky regions, cone search and shareable posts."""
from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.auth import _create_access_token
from social_api.db import Base, get_db
from social_api.main import create_app
from social_api.models import Observation, User


@pytest.fixture
def env():
    engine = create_engine(
        'sqlite+pysqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        alice = User(username='alice', display_name='Alice', email='alice@example.invalid',
                     password_hash='test-hash')
        bob = User(username='bob', display_name='Bob', email='bob@example.invalid',
                   password_hash='test-hash')
        db.add_all([alice, bob])
        db.commit()
        db.refresh(alice)
        db.refresh(bob)
        headers = {
            user.username: {'Authorization': f'Bearer {_create_access_token(user).access_token}'}
            for user in (alice, bob)
        }
    app = create_app()

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            yield client, headers, engine
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def save(client, headers, ra=133.795129, dec=-7.245147, fov=6, detector=2, owner='alice'):
    response = client.post('/v1/observations', headers=headers[owner],
                           json={'ra_deg': ra, 'dec_deg': dec, 'fov_arcmin': fov, 'detector': detector})
    assert response.status_code == 201, response.text
    return response.json()


def test_save_and_open_an_observation(env):
    client, headers, engine = env
    assert client.post('/v1/observations', json={
        'ra_deg': 1, 'dec_deg': 2, 'fov_arcmin': 6, 'detector': 1,
    }).status_code == 401
    obs = save(client, headers)
    assert obs['mission'] == 'SPHEREx'
    assert obs['data_release'] is None  # no false claim about processed images
    assert obs['viewer_path'] == f"/?observation_id={obs['id']}"
    assert client.get('/v1/observations/' + obs['id']).json() == obs
    with Session(engine) as db:
        row = db.get(Observation, __import__('uuid').UUID(obs['id']))
        assert row.creator_id is not None
        assert row.ra_deg == pytest.approx(133.795129)
    assert client.get('/v1/users/me/observations').status_code == 401
    assert [o['id'] for o in client.get('/v1/users/me/observations',
                                     headers=headers['alice']).json()] == [obs['id']]
    assert client.get('/v1/users/me/observations', headers=headers['bob']).json() == []
    assert client.get(f'/v1/observations/{uuid4()}').status_code == 404


@pytest.mark.parametrize('payload', [
    {'ra_deg': -1}, {'ra_deg': 360}, {'dec_deg': -90.01},
    {'dec_deg': 90.01}, {'fov_arcmin': 0.5}, {'fov_arcmin': 13},
    {'detector': 0}, {'detector': 7}, {'data_release': 'DR1'},
    {'ra_deg': 'nan'}, {'dec_deg': 'Infinity'},
])
def test_validation_rejects_invalid_or_unverified_source(env, payload):
    client, headers, _ = env
    data = {'ra_deg': 133.795, 'dec_deg': -7.245, 'fov_arcmin': 6, 'detector': 2}
    data.update(payload)
    result = client.post('/v1/observations', headers=headers['alice'], json=data)
    assert result.status_code == 422, result.text


def test_cone_search_uses_angular_separation_and_wraps_right_ascension(env):
    client, headers, _ = env
    close = save(client, headers, ra=359.99, dec=2, detector=1)
    wrap = save(client, headers, ra=0.01, dec=2, detector=1)
    far = save(client, headers, ra=10, dec=2, detector=1)
    other_detector = save(client, headers, ra=359.99, dec=2, detector=3)
    url = '/v1/observations?ra_deg=0&dec_deg=2&radius_arcmin=2'
    result = client.get(url)
    assert result.status_code == 200, result.text
    ids = {o['id'] for o in result.json()}
    assert {close['id'], wrap['id'], other_detector['id']}.issubset(ids)
    assert far['id'] not in ids
    one_detector = client.get(url + '&detector=1')
    assert {o['id'] for o in one_detector.json()} == {close['id'], wrap['id']}
    assert client.get('/v1/observations?ra_deg=12').status_code == 422
    assert client.get('/v1/observations?dec_deg=12').status_code == 422
    assert client.get('/v1/observations?radius_arcmin=200').status_code == 422
    assert client.get('/v1/observations?limit=0').status_code == 422
    assert len(client.get('/v1/observations?limit=2').json()) == 2


def test_near_pole_search_and_pagination(env):
    client, headers, _ = env
    one = save(client, headers, ra=0, dec=89.999, detector=2)
    two = save(client, headers, ra=180, dec=89.999, detector=2)
    result = client.get('/v1/observations?ra_deg=90&dec_deg=90&radius_arcmin=1')
    assert {o['id'] for o in result.json()} == {one['id'], two['id']}
    assert len(client.get('/v1/observations?limit=1&offset=1').json()) == 1


def test_link_post_to_saved_region_and_shared_viewer(env):
    client, headers, _ = env
    region = save(client, headers)
    payload = {
        'caption': 'Possible proper motion, inspect the data',
        'visibility': 'public',
        'observation_id': region['id'],
    }
    created = client.post('/v1/posts', headers=headers['bob'], json=payload)
    assert created.status_code == 201, created.text
    public_post = created.json()
    assert public_post['observation_id'] == region['id']
    feed = client.get('/v1/feed').json()
    assert feed[0]['observation_id'] == region['id']
    # Another visitor can recover original parameters and shareable UI route.
    other = client.get('/v1/observations/' + feed[0]['observation_id']).json()
    assert (other['ra_deg'], other['dec_deg'], other['fov_arcmin'], other['detector']) == (
        region['ra_deg'], region['dec_deg'], region['fov_arcmin'], region['detector'])
    assert other['viewer_path'].startswith('/?observation_id=')
    posts = client.get(f"/v1/observations/{region['id']}/posts")
    assert [post['id'] for post in posts.json()] == [public_post['id']]


def test_observation_timeline_respects_post_visibility(env):
    client, headers, _ = env
    region = save(client, headers)
    published = {}
    for visibility in ('public', 'unlisted', 'private'):
        response = client.post('/v1/posts', headers=headers['alice'], json={
            'caption': f'{visibility} post', 'visibility': visibility,
            'observation_id': region['id'],
        })
        assert response.status_code == 201, response.text
        published[visibility] = response.json()['id']
    url = f"/v1/observations/{region['id']}/posts"
    anonymous = client.get(url)
    assert anonymous.status_code == 200
    assert {p['id'] for p in anonymous.json()} == {published['public']}
    assert {p['id'] for p in client.get(url, headers=headers['bob']).json()} == {published['public']}
    owned = client.get(url, headers=headers['alice']).json()
    assert {p['id'] for p in owned} == set(published.values())
    assert client.get(url + '?limit=0').status_code == 422
    assert client.get('/v1/observations/' + str(uuid4()) + '/posts').status_code == 404


def test_combined_api_has_persistence_endpoints():
    from app import app
    schema = app.openapi()
    assert '/v1/observations' in schema['paths']
    assert '/v1/users/me/observations' in schema['paths']
    assert '/v1/observations/{observation_id}/posts' in schema['paths']
    assert '/api/search' in schema['paths']
