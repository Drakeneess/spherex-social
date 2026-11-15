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
from social_api.models import AuthSession, Observation, Post, SkySearchJob, User


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
        devices = []
        for user in (first, second):
            device = AuthSession(
                user_id=user.id, secret_hash=uuid4().hex + uuid4().hex,
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
            db.add(device)
            db.flush()
            devices.append(device)
        token_a, token_b = (
            _create_access_token(first, devices[0]).access_token,
            _create_access_token(second, devices[1]).access_token,
        )
        db.commit()

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


def test_old_post_reuses_matching_real_sky_job_and_real_frame_dates(env, monkeypatch):
    from persistent_sky import _schedule
    import persistent_sky
    client, engine, author_id, _, headers = env
    scheduled = []
    monkeypatch.setattr(persistent_sky, "_schedule", lambda jid: scheduled.append(jid))
    with Session(engine) as db:
        region = Observation(creator_id=author_id, ra_deg=162.299, dec_deg=-53.318,
                             fov_arcmin=6.0, detector=2)
        task = SkySearchJob(
            id=uuid4(), ra=162.299, dec=-53.318, size_arcmin=6.0,
            detector=2, max_frames=2, demo=False, status="complete",
            source="sia2",
            frame_states=[
                {"index": 0, "status": "ready"},
                {"index": 1, "status": "ready"},
            ],
            result_data={"observations": [
                {"index": 0, "date": "2025-05-15T00:00:00"},
                {"index": 1, "date": "2025-09-15T00:00:00"},
            ]},
        )
        db.add_all([region, task])
        db.commit()
        db.refresh(region)
        task_id, region_id = str(task.id), str(region.id)
    post_id = publish(client, headers["alpha"], "Movimiento",
                      observation_id=region_id).json()["id"]
    result = client.post(f"/v1/posts/{post_id}/blink")
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["job_id"] == task_id
    assert data["status"] == "complete"
    assert data["source"] == "sia2"
    assert [x["date"] for x in data["frames"]] == [
        "2025-05-15T00:00:00", "2025-09-15T00:00:00",
    ]
    assert client.post(f"/v1/posts/{post_id}/blink").json()["job_id"] == task_id
    assert not scheduled
    with Session(engine) as db:
        assert str(db.get(Post, UUID(post_id)).sky_job_id) == task_id


def test_old_post_prepares_two_epoch_job_only_once(env, monkeypatch):
    import persistent_sky
    client, engine, author_id, _, headers = env
    scheduled = []
    monkeypatch.setattr(persistent_sky, "_schedule", lambda jid: scheduled.append(str(jid)))
    with Session(engine) as db:
        region = Observation(creator_id=author_id, ra_deg=133.795129, dec_deg=-7.245147,
                             fov_arcmin=6, detector=2)
        db.add(region)
        db.commit()
        db.refresh(region)
        region_id = str(region.id)
    post_id = publish(client, headers["alpha"], "Mi campo",
                      observation_id=region_id).json()["id"]
    first = client.post(f"/v1/posts/{post_id}/blink")
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "queued"
    job_id = first.json()["job_id"]
    assert client.post(f"/v1/posts/{post_id}/blink").json()["job_id"] == job_id
    assert scheduled == [job_id]
    with Session(engine) as db:
        task = db.get(SkySearchJob, UUID(job_id))
        assert task is not None
        assert task.max_frames == 2
        assert task.demo is False
        assert task.ra == 133.795129


def test_post_may_attach_only_a_matching_real_ready_job(env):
    client, engine, author_id, _, headers = env
    with Session(engine) as db:
        region = Observation(creator_id=author_id, ra_deg=133.795129,
                             dec_deg=-7.245147, fov_arcmin=6.0, detector=2)
        other = Observation(creator_id=author_id, ra_deg=12.0,
                            dec_deg=12.0, fov_arcmin=6, detector=2)
        task = SkySearchJob(
            id=uuid4(), ra=133.795129, dec=-7.245147,
            size_arcmin=6, detector=2, max_frames=12,
            source="sia2", status="frames", demo=False,
            frame_states=[{"index": 0, "status": "ready"}],
            result_data={"count": 12, "observations": []},
        )
        not_ready = SkySearchJob(
            id=uuid4(), ra=133.795129, dec=-7.245147,
            size_arcmin=6, detector=2, max_frames=2, demo=False,
            status="queued", frame_states=[],
        )
        demo = SkySearchJob(
            id=uuid4(), ra=133.795129, dec=-7.245147,
            size_arcmin=6, detector=2, max_frames=2, demo=True,
            status="complete", frame_states=[{"index": 0, "status": "ready"}],
            result_data={"count": 2, "observations": []},
        )
        db.add_all([region, other, task, not_ready, demo])
        db.commit()
        for entity in (region, other, task, not_ready, demo):
            db.refresh(entity)
        region_id, other_id = str(region.id), str(other.id)
        task_id, not_ready_id, demo_id = str(task.id), str(not_ready.id), str(demo.id)
    created = publish(client, headers["alpha"], "Vista real",
                      observation_id=region_id, sky_job_id=task_id)
    assert created.status_code == 201, created.text
    post_id = created.json()["id"]
    with Session(engine) as db:
        assert str(db.get(Post, UUID(post_id)).sky_job_id) == task_id
    for invalid in (
        {"observation_id": other_id, "sky_job_id": task_id},
        {"observation_id": region_id, "sky_job_id": not_ready_id},
        {"observation_id": region_id, "sky_job_id": demo_id},
        {"sky_job_id": task_id},
    ):
        assert publish(client, headers["alpha"], "No válido",
                       **invalid).status_code == 422
    assert client.patch(f"/v1/posts/{post_id}", headers=headers["alpha"],
                        json={"observation_id": other_id}).status_code == 200
    with Session(engine) as db:
        assert db.get(Post, UUID(post_id)).sky_job_id is None


def test_private_blink_preview_is_not_public(env, monkeypatch):
    import persistent_sky
    client, engine, author_id, _, headers = env
    monkeypatch.setattr(persistent_sky, "_schedule", lambda _jid: None)
    with Session(engine) as db:
        region = Observation(creator_id=author_id, ra_deg=17, dec_deg=11,
                             fov_arcmin=6, detector=2)
        db.add(region)
        db.commit()
        db.refresh(region)
        region_id = str(region.id)
    private = publish(client, headers["alpha"], "Privado",
                      visibility="private", observation_id=region_id).json()["id"]
    assert client.post(f"/v1/posts/{private}/blink").status_code == 404
    assert client.post(f"/v1/posts/{private}/blink", headers=headers["beta"]).status_code == 404
    assert client.post(f"/v1/posts/{private}/blink", headers=headers["alpha"]).status_code == 200
    unlisted = publish(client, headers["alpha"], "Con enlace",
                       visibility="unlisted", observation_id=region_id).json()["id"]
    assert client.post(f"/v1/posts/{unlisted}/blink").status_code == 200
    text_post = publish(client, headers["alpha"], "Solo texto").json()["id"]
    assert client.post(f"/v1/posts/{text_post}/blink").status_code == 404


def test_preparing_blink_respects_active_worker_capacity(env, monkeypatch):
    import persistent_sky
    client, engine, author_id, _, headers = env
    monkeypatch.setattr(persistent_sky, "_schedule", lambda _jid: None)
    with Session(engine) as db:
        region = Observation(creator_id=author_id, ra_deg=30, dec_deg=30,
                             fov_arcmin=6, detector=2)
        db.add(region)
        for n in range(persistent_sky.MAX_ACTIVE_JOBS):
            db.add(SkySearchJob(id=uuid4(), ra=n, dec=n, size_arcmin=6,
                                detector=2, max_frames=2, status="queued",
                                demo=False, frame_states=[]))
        db.commit()
        db.refresh(region)
        region_id = str(region.id)
    post_id = publish(client, headers["alpha"], "Con muchos trabajos",
                      observation_id=region_id).json()["id"]
    assert client.post(f"/v1/posts/{post_id}/blink").status_code == 429


def test_reveal_recipe_is_validated_persisted_and_visible_in_blink(env):
    client, engine, author_id, _, headers = env
    import persistent_sky
    from unittest.mock import patch
    with Session(engine) as db:
        observation = Observation(creator_id=author_id, ra_deg=133.795129,
                                  dec_deg=-7.245147, fov_arcmin=6, detector=2)
        task = SkySearchJob(
            id=uuid4(), ra=133.795129, dec=-7.245147, size_arcmin=6,
            detector=2, max_frames=2, demo=False, source="sia2", status="complete",
            result_data={"count": 2, "observations": []},
            frame_states=[{"index": 0, "status": "ready",
                           "metadata": {"raw_available": True}},
                          {"index": 1, "status": "ready",
                           "metadata": {"raw_available": True}}],
        )
        old = SkySearchJob(
            id=uuid4(), ra=133.795129, dec=-7.245147, size_arcmin=6,
            detector=2, max_frames=2, demo=False, source="sia2", status="complete",
            result_data={"count": 2, "observations": []},
            frame_states=[{"index": 0, "status": "ready"}],
        )
        db.add_all([observation, task, old])
        db.commit()
        db.refresh(observation)
        db.refresh(task)
        db.refresh(old)
        observation_id, task_id, old_id = str(observation.id), str(task.id), str(old.id)

    recipe = {"version": 1, "palette": "violet", "stretch": "log",
              "black": 1.5, "white": 99, "gamma": 1.3,
              "highlight": "#fF0088", "shadow": "#110022",
              "format": "portrait", "sampling": "smooth"}
    created = publish(client, headers["alpha"], "Revelado",
                      observation_id=observation_id, sky_job_id=task_id,
                      display_recipe=recipe)
    assert created.status_code == 201, created.text
    posted = created.json()
    assert posted["display_recipe"]["palette"] == "violet"
    assert posted["display_recipe"]["highlight"] == "#ff0088"
    post_id = posted["id"]
    assert client.get(f"/v1/posts/{post_id}").json()["display_recipe"] == posted["display_recipe"]
    assert client.get("/v1/feed").json()[0]["display_recipe"] == posted["display_recipe"]
    with patch.object(persistent_sky, "_schedule") as schedule:
        result = client.post(f"/v1/posts/{post_id}/blink")
    assert result.status_code == 200
    assert result.json()["display_recipe"] == posted["display_recipe"]
    schedule.assert_not_called()

    bad = [
        {**recipe, "palette": "made-up"},
        {**recipe, "gamma": 10},
        {**recipe, "highlight": "<script>"},
        {**recipe, "unknown": 3},
    ]
    for candidate in bad:
        assert publish(client, headers["alpha"], "Bad", observation_id=observation_id,
                       sky_job_id=task_id, display_recipe=candidate).status_code == 422
    assert publish(client, headers["alpha"], "No raw",
                   observation_id=observation_id, sky_job_id=old_id,
                   display_recipe=recipe).status_code == 422
    assert publish(client, headers["alpha"], "Only text",
                   display_recipe=recipe).status_code == 422
    assert client.patch(f"/v1/posts/{post_id}",headers=headers["alpha"],
                        json={"display_recipe": None}).status_code == 200
    assert client.get(f"/v1/posts/{post_id}").json()["display_recipe"] is None
