from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from social_api.db import Base, get_db
from social_api.main import app
from social_api.models import User, Post, Observation

engine = create_engine('sqlite+pysqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)


def override_db():
    with Session(engine) as db:
        yield db

app.dependency_overrides[get_db] = override_db
client = TestClient(app)


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def test_health_and_ready():
    assert client.get('/v1/health').json()['status'] == 'ok'
    assert client.get('/v1/ready').json()['database'] == 'connected'


def test_empty_feed_and_nonexistent_observation():
    assert client.get('/v1/feed').json() == []
    assert client.get('/v1/observations/00000000-0000-0000-0000-000000000001').status_code == 404


def test_feed_only_public_posts():
    with Session(engine) as db:
        user = User(username='astronomer', display_name='Astronomer', email='astronomer@example.invalid', password_hash='not-a-real-hash')
        db.add(user)
        db.flush()
        obs = Observation(creator_id=user.id, ra_deg=133.795, dec_deg=-7.245, fov_arcmin=6, detector=2, data_release='DR1')
        db.add(obs)
        db.flush()
        obs_id = obs.id
        db.add_all([
            Post(author_id=user.id, observation_id=obs.id, caption='Possible motion', visibility='public'),
            Post(author_id=user.id, observation_id=obs.id, caption='Private notes', visibility='private'),
        ])
        db.commit()
    feed = client.get('/v1/feed').json()
    assert len(feed) == 1 and feed[0]['username'] == 'astronomer'
    assert feed[0]['caption'] == 'Possible motion'
    observation = client.get(f'/v1/observations/{obs_id}').json()
    assert observation['data_release'] == 'DR1'


def test_no_anonymous_social_writes():
    assert client.post('/v1/posts', json={'caption': 'hi'}).status_code == 404
