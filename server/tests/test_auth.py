"""Authentication, JWT verification and profile visibility tests."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.auth import password_hasher
from social_api.config import get_settings
from social_api.db import Base, get_db
from social_api.main import app
from social_api.models import User

engine = create_engine('sqlite+pysqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)


def override_db():
    with Session(engine) as db:
        yield db


@pytest.fixture
def client():
    Base.metadata.create_all(engine)
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as testing_client:
            yield testing_client
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        Base.metadata.drop_all(engine)


def register(client, username='skywatcher', email='sky@example.com'):
    return client.post('/v1/auth/register', json={
        'username': username,
        'display_name': 'Sky Watcher',
        'email': email,
        'password': 'correct-horse-battery-2026',
    })


def login(client, email='sky@example.com', password='correct-horse-battery-2026'):
    return client.post('/v1/auth/login', json={'email': email, 'password': password})


def test_register_login_and_me(client):
    created = register(client, username='SkyWatcher', email='Sky@Example.com')
    assert created.status_code == 201, created.text
    assert created.json()['username'] == 'skywatcher'
    assert created.json()['email'] == 'sky@example.com'
    assert 'password' not in created.text and 'password_hash' not in created.text
    with Session(engine) as db:
        user = db.query(User).one()
        assert user.password_hash.startswith('$argon2id$')
        assert password_hasher.verify(user.password_hash, 'correct-horse-battery-2026')
    response = login(client, email='SKY@EXAMPLE.COM')
    assert response.status_code == 200, response.text
    token = response.json()['access_token']
    assert response.json()['token_type'] == 'bearer'
    assert response.json()['expires_in'] == 1800
    settings = get_settings()
    claims = jwt.decode(token, settings.jwt_secret, algorithms=['HS256'],
                        issuer=settings.jwt_issuer, audience=settings.jwt_audience)
    assert claims['sub'] == created.json()['id']
    me = client.get('/v1/users/me', headers={'Authorization': f'Bearer {token}'})
    assert me.status_code == 200
    assert me.json()['email'] == 'sky@example.com'
    public = client.get('/v1/users/skywatcher')
    assert public.status_code == 200
    assert 'email' not in public.json()


def test_registration_duplicates_and_reserved_username(client):
    assert register(client).status_code == 201
    assert register(client).status_code == 409
    assert register(client, 'someone', 'SKY@EXAMPLE.COM').status_code == 409
    assert register(client, 'me', 'other@example.com').status_code == 422
    assert register(client, 'bad-name!', 'other@example.com').status_code == 422
    assert client.post('/v1/auth/register', json={
        'username': 'username', 'display_name': '  ', 'email': 'good@example.com',
        'password': 'safe-password-2026'
    }).status_code == 422


def test_bad_password_and_missing_account_same_error(client):
    register(client)
    bad = login(client, password='wrong-password')
    missing = login(client, email='missing@example.com')
    assert bad.status_code == missing.status_code == 401
    assert bad.json() == missing.json()
    assert bad.headers['www-authenticate'] == 'Bearer'


def test_private_profile_requires_valid_token(client):
    assert client.get('/v1/users/me').status_code == 401
    assert client.patch('/v1/users/me', json={'display_name': 'Hacker'}).status_code == 401
    assert client.get('/v1/users/me', headers={'Authorization': 'Bearer invalid.jwt.token'}).status_code == 401
    register(client)
    good = login(client).json()['access_token']
    settings = get_settings()
    bad_audience = jwt.encode({
        'sub': '00000000-0000-0000-0000-000000000000',
        'iss': settings.jwt_issuer, 'aud': 'wrong-audience',
        'iat': datetime.now(timezone.utc), 'nbf': datetime.now(timezone.utc),
        'exp': datetime.now(timezone.utc) + timedelta(minutes=5), 'jti': 'x',
    }, settings.jwt_secret, algorithm='HS256')
    assert client.get('/v1/users/me', headers={'Authorization': f'Bearer {bad_audience}'}).status_code == 401
    expired = jwt.decode(good, options={'verify_signature': False})
    expired.update({'iat': datetime.now(timezone.utc) - timedelta(hours=2),
                    'nbf': datetime.now(timezone.utc) - timedelta(hours=2),
                    'exp': datetime.now(timezone.utc) - timedelta(hours=1)})
    token = jwt.encode(expired, settings.jwt_secret, algorithm='HS256')
    assert client.get('/v1/users/me', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_edit_profile_and_public_privacy(client):
    register(client)
    token = login(client).json()['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    patch = client.patch('/v1/users/me', headers=headers,
                         json={'display_name': '  Astral Nomad  ', 'bio': '  Looking for motion  '})
    assert patch.status_code == 200, patch.text
    assert patch.json()['display_name'] == 'Astral Nomad'
    assert patch.json()['bio'] == 'Looking for motion'
    public = client.get('/v1/users/skywatcher').json()
    assert public['bio'] == 'Looking for motion'
    assert 'email' not in public
    assert client.patch('/v1/users/me', headers=headers, json={'display_name': None}).status_code == 422
    assert client.patch('/v1/users/me', headers=headers, json={'username': 'renamed'}).status_code == 422
    assert client.get('/v1/users/skywatcher').status_code == 200
    assert client.patch('/v1/users/me', headers=headers, json={'bio': None}).json()['bio'] is None
    assert client.get('/v1/users/nobody').status_code == 404


def test_combined_api_exposes_auth():
    from app import app as combined
    paths = combined.openapi()['paths']
    assert '/v1/auth/register' in paths
    assert '/v1/auth/login' in paths
    assert '/v1/users/me' in paths


def test_persistent_cookie_renews_short_lived_jwt_and_is_http_only(client):
    from social_api.auth import REFRESH_SECONDS
    from social_api.models import AuthSession
    register(client)
    response = login(client)
    assert response.status_code == 200
    cookie = response.headers.get('set-cookie', '')
    assert 'astrogram_refresh=' in cookie
    assert 'httponly' in cookie.lower()
    assert 'samesite=lax' in cookie.lower()
    assert 'path=/v1/auth' in cookie.lower()
    assert f'max-age={REFRESH_SECONDS}' in cookie.lower()
    with Session(engine) as db:
        entry = db.query(AuthSession).one()
        assert len(entry.secret_hash) == 64
        assert entry.secret_hash not in cookie
    initial_token = response.json()['access_token']
    first = jwt.decode(initial_token, get_settings().jwt_secret,
                       algorithms=['HS256'], issuer=get_settings().jwt_issuer,
                       audience=get_settings().jwt_audience)
    renewed = client.post('/v1/auth/refresh')
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()['expires_in'] == 1800
    renewed_claims = jwt.decode(renewed.json()['access_token'],
                               get_settings().jwt_secret,
                               algorithms=['HS256'], issuer=get_settings().jwt_issuer,
                               audience=get_settings().jwt_audience)
    assert first['sid'] == renewed_claims['sid']
    assert first['jti'] != renewed_claims['jti']
    assert client.get('/v1/users/me',headers={
        'Authorization': f"Bearer {renewed.json()['access_token']}",
    }).status_code == 200
    with Session(engine) as db:
        assert db.query(AuthSession).one().last_used_at is not None


def test_logout_revokes_server_session_and_existing_access_token(client):
    from social_api.models import AuthSession
    register(client)
    login_response = login(client)
    token = login_response.json()['access_token']
    assert client.get('/v1/users/me',headers={
        'Authorization': f'Bearer {token}',
    }).status_code == 200
    assert client.post('/v1/auth/logout').status_code == 204
    assert client.post('/v1/auth/refresh').status_code == 401
    assert client.get('/v1/users/me',headers={
        'Authorization': f'Bearer {token}',
    }).status_code == 401
    with Session(engine) as db:
        assert db.query(AuthSession).count() == 0


def test_device_logouts_do_not_revoke_other_sessions(client):
    register(client)
    first=login(client)
    token_a=first.json()['access_token']
    second=login(client)
    token_b=second.json()['access_token']
    assert token_a != token_b
    assert client.post('/v1/auth/logout').status_code == 204
    assert client.get('/v1/users/me',headers={
        'Authorization': f'Bearer {token_b}',
    }).status_code == 401
    assert client.get('/v1/users/me',headers={
        'Authorization': f'Bearer {token_a}',
    }).status_code == 200


def test_expired_session_rejects_refresh_and_stale_jwt(client):
    from social_api.models import AuthSession
    register(client)
    token=login(client).json()['access_token']
    with Session(engine) as db:
        entry=db.query(AuthSession).one()
        entry.expires_at=datetime.now(timezone.utc)-timedelta(seconds=10)
        db.commit()
    assert client.post('/v1/auth/refresh').status_code == 401
    assert client.get('/v1/users/me', headers={
        'Authorization': f'Bearer {token}',
    }).status_code == 401


def test_refresh_rejects_invalid_cookie_without_creating_device_session(client):
    from social_api.models import AuthSession
    client.cookies.set('astrogram_refresh','invalid-cookie',path='/v1/auth')
    assert client.post('/v1/auth/refresh').status_code == 401
    assert client.post('/v1/auth/logout').status_code == 204
    with Session(engine) as db:
        assert db.query(AuthSession).count() == 0
