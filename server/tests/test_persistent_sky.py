"""Persistent sky sessions: independent HTTP requests, restart recovery, no expiry."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app as explorer
import persistent_sky as sky
import sky_storage
from social_api.db import Base
from social_api.models import SkySearchJob


def payload(job_id=None, **changes):
    data = {
        "job_id": str(job_id or uuid.uuid4()), "ra": 133.795129,
        "dec": -7.245147, "size_arcmin": 6,
        "detector": 2, "max_frames": 2, "demo": False,
    }
    data.update(changes)
    return data


def sia_row(index):
    return {
        "path": f"/ibe/data/spherex/dr1/level2/a/b/frame{index}.fits",
        "mjd": 60810.0 + index,
        "date": f"2025-05-15T00:00:0{index}.000",
        "release": "DR1",
    }


@pytest.fixture()
def harness(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'sky.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(sky, "get_session_factory", lambda: maker)
    # The test drives execution deterministically; no external scheduling.
    monkeypatch.setattr(sky, "_schedule", lambda _job: None)
    image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    saved = {}

    def store(jid, index, data):
        saved[(str(jid), index)] = data
        return f"sky/v1/{jid}/{index:02d}.png"

    def read(jid, index):
        return saved[(str(jid), index)]

    monkeypatch.setattr(sky, "put_preview", store)
    monkeypatch.setattr(sky, "get_preview", read)
    mock_queries = []
    def fake_catalog(ra, dec, size, detector):
        mock_queries.append((ra, dec, size, detector))
        return {
            "complete": True, "records": [sia_row(0), sia_row(1), sia_row(2)],
            "matching_detector_rows": 3, "elapsed_ms": 102,
            "query_status": "OK", "attempts": 1,
        }
    monkeypatch.setattr(explorer, "query_sia2", fake_catalog)
    monkeypatch.setattr(explorer, "render_real", lambda _session, _rec: {
        "image": image, "mode": "real",
        "wavelength_um": None, "bandwidth_um": None,
        "pixel_flags_nonzero_fraction": 0.0,
        "timing_ms": {"total": 3},
    })
    with TestClient(explorer.app) as client:
        yield client, maker, mock_queries, saved
    engine.dispose()


def test_create_is_idempotent_and_allows_same_job_in_any_tab(harness):
    client, maker, queries, saved = harness
    request = payload()
    first = client.post("/api/sky/jobs", json=request)
    assert first.status_code == 202, first.text
    assert first.json()["status"] == "queued"
    again = client.post("/api/sky/jobs", json=request)
    assert again.status_code == 200
    assert again.json()["job_id"] == request["job_id"]
    assert not queries

    sky._run(uuid.UUID(request["job_id"]))
    one = client.get(f"/api/sky/jobs/{request['job_id']}")
    two = client.get(f"/api/sky/jobs/{request['job_id']}")
    assert one.status_code == two.status_code == 200
    assert one.json() == two.json()
    assert one.json()["status"] == "complete"
    assert one.json()["result"]["total_matches"] == 3
    assert one.json()["result"]["count"] == 2
    assert all(frame["status"] == "ready" for frame in one.json()["frames"])
    assert len(queries) == 1
    frame = client.get(f"/api/sky/jobs/{request['job_id']}/frames/0")
    assert frame.status_code == 200
    assert frame.json()["mode"] == "real"
    assert frame.json()["image"].startswith("data:image/png;base64,")
    assert len(saved) == 2
    assert "records_data" not in json.dumps(one.json())
    assert "frame0.fits" not in json.dumps(one.json())


def test_idempotency_key_cannot_be_reused_for_other_coordinates(harness):
    client, *_ = harness
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    conflict = client.post("/api/sky/jobs", json={**data, "ra": 26.0})
    assert conflict.status_code == 409


def test_job_persists_without_one_hour_expiry(harness):
    client, maker, *_ = harness
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    with maker() as db:
        row = db.get(SkySearchJob, uuid.UUID(data["job_id"]))
        row.created_at = datetime.now(timezone.utc) - timedelta(days=400)
        db.commit()
    assert client.get(f"/api/sky/jobs/{data['job_id']}").status_code == 200


def test_worker_restarts_without_repeating_successful_frames(harness):
    client, maker, queries, saved = harness
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    sky._run(uuid.UUID(data["job_id"]))
    assert len(saved) == 2
    with maker() as db:
        row = db.get(SkySearchJob, uuid.UUID(data["job_id"]))
        states = [dict(item) for item in row.frame_states]
        states[1] = {"index": 1, "status": "pending"}
        row.frame_states = states
        row.status = "frames"
        row.lease_owner = None
        row.lease_until = None
        db.commit()
    saved.pop((data["job_id"], 1))
    sky._run(uuid.UUID(data["job_id"]))
    assert len(queries) == 1  # no repeated discovery
    assert len(saved) == 2
    assert client.get(f"/api/sky/jobs/{data['job_id']}").json()["status"] == "complete"


def test_cancelled_job_is_not_restarted_or_reclaimed(harness):
    client, _, queries, _saved = harness
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    assert client.delete(f"/api/sky/jobs/{data['job_id']}").status_code == 204
    sky._run(uuid.UUID(data["job_id"]))
    assert not queries
    assert client.get(f"/api/sky/jobs/{data['job_id']}").json()["status"] == "cancelled"


def test_empty_sia_catalog_is_permanent_empty_result(harness, monkeypatch):
    client, _, queries, _ = harness
    monkeypatch.setattr(explorer, "query_sia2",
                        lambda *_args: {"complete": True, "records": [],
                                      "matching_detector_rows": 0, "elapsed_ms": 9,
                                      "query_status": "OK", "attempts": 1})
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    sky._run(uuid.UUID(data["job_id"]))
    state = client.get(f"/api/sky/jobs/{data['job_id']}").json()
    assert state["status"] == "empty"
    assert state["result"]["count"] == 0
    assert state["frames"] == []


def test_failed_frame_does_not_destroy_successful_frame(harness, monkeypatch):
    client, _, _, saved = harness
    real = explorer.render_real
    def occasional_failure(session, record):
        if "frame2.fits" in record["url"]:
            raise explorer.FrameProcessingError("apertura_fits", "HTTPError", 404, False)
        return real(session, record)
    monkeypatch.setattr(explorer, "render_real", occasional_failure)
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    sky._run(uuid.UUID(data["job_id"]))
    state = client.get(f"/api/sky/jobs/{data['job_id']}").json()
    assert state["status"] == "partial"
    assert [f["status"] for f in state["frames"]] == ["ready", "failed"]
    assert client.get(f"/api/sky/jobs/{data['job_id']}/frames/0").status_code == 200
    assert client.get(f"/api/sky/jobs/{data['job_id']}/frames/1").status_code == 404
    assert len(saved) == 1


def test_sky_storage_local_disk_survives_call_boundary(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "development")
    for key in ("SKY_S3_ENDPOINT", "SKY_S3_BUCKET", "SKY_S3_REGION",
                "SKY_S3_ACCESS_KEY", "SKY_S3_SECRET_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(sky_storage, "LOCAL_STORE", tmp_path)
    raw = sky_storage.PNG_SIGNATURE + b"very small fake PNG payload"
    import base64
    image = sky_storage.PNG_PREFIX + base64.b64encode(raw).decode()
    jid = uuid.uuid4()
    sky_storage.put_preview(jid, 1, image)
    assert sky_storage.get_preview(jid, 1) == image
    with pytest.raises(ValueError):
        sky_storage.put_preview(jid, 17, image)


def test_job_validation_rejects_invalid_payloads(harness):
    client, *_ = harness
    for change in ({"detector": 8}, {"max_frames": 17}, {"ra": -1},
                   {"size_arcmin": 0}, {"job_id": "not-a-uuid"}):
        data = payload(**change)
        assert client.post("/api/sky/jobs", json=data).status_code == 422
