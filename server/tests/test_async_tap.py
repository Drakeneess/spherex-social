"""Mock IRSA TAP async lifecycle; no external services in CI."""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app as explorer


class FakeRemoteJob:
    def __init__(self):
        self.phase = "PENDING"
        self.started = False
        self.aborted = False
        self.deleted = False
        self.rows = []

    def run(self):
        self.started = True
        self.phase = "QUEUED"

    def fetch_result(self):
        return self.rows

    def abort(self):
        self.aborted = True
        self.phase = "ABORTED"

    def delete(self):
        self.deleted = True


class FakeTap:
    def __init__(self):
        self.jobs = []
        self.query = ""
        self.maxrec = None

    def submit_job(self, query, maxrec=None):
        self.query = query
        self.maxrec = maxrec
        job = FakeRemoteJob()
        self.jobs.append(job)
        return job


@pytest.fixture()
def harness(monkeypatch):
    tap = FakeTap()
    monkeypatch.setattr(explorer, "Irsa", SimpleNamespace(tap=tap))
    with explorer._lock:
        explorer._tap_jobs.clear()
        explorer._sessions.clear()
    with TestClient(explorer.app) as client:
        yield client, tap
    with explorer._lock:
        explorer._tap_jobs.clear()
        explorer._sessions.clear()


def payload():
    return {
        "ra": 133.795129, "dec": -7.245147, "size_arcmin": 6,
        "detector": 2, "max_frames": 12,
    }


def test_submit_queue_poll_and_finish(harness):
    client, tap = harness
    response = client.post("/api/search/jobs", json=payload())
    assert response.status_code == 202, response.text
    ticket = response.json()["job_id"]
    assert tap.maxrec == 5000
    assert "SPHEREx-D2" in tap.query
    assert tap.jobs[0].started

    pending = client.get(f"/api/search/jobs/{ticket}")
    assert pending.status_code == 200
    assert pending.json() == {"phase": "QUEUED"}

    tap.jobs[0].phase = "EXECUTING"
    assert client.get(f"/api/search/jobs/{ticket}").json()["phase"] == "EXECUTING"

    tap.jobs[0].rows = [{
        "uri": "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/test.fits?center=133.795129,-7.245147d&size=0.1",
        "time_bounds_lower": 60810.0,
    }]
    tap.jobs[0].phase = "COMPLETED"
    completed = client.get(f"/api/search/jobs/{ticket}").json()
    assert completed["phase"] == "COMPLETED"
    assert completed["result"]["source"] == "irsa"
    assert completed["result"]["count"] == 1
    search_id = completed["result"]["search_id"]
    assert explorer.get_session(search_id).source == "irsa"
    assert client.get(f"/api/search/jobs/{ticket}").json()["result"]["search_id"] == search_id

    released = client.delete(f"/api/search/jobs/{ticket}")
    assert released.status_code == 204
    assert tap.jobs[0].deleted
    assert client.get(f"/api/search/jobs/{ticket}").status_code == 404
    # The preview session remains valid even when its TAP job is deleted.
    assert explorer.get_session(search_id).source == "irsa"


def test_failure_and_cancellation(harness):
    client, tap = harness
    ticket = client.post("/api/search/jobs", json=payload()).json()["job_id"]
    tap.jobs[0].phase = "ERROR"
    error = client.get(f"/api/search/jobs/{ticket}")
    assert error.status_code == 200
    assert error.json()["phase"] == "ERROR"
    assert "error" in error.json()

    another = client.post("/api/search/jobs", json=payload()).json()["job_id"]
    assert client.delete(f"/api/search/jobs/{another}").status_code == 204
    assert tap.jobs[1].aborted
    assert tap.jobs[1].deleted


def test_validation_and_unknown_job(harness):
    client, tap = harness
    assert client.get("/api/search/jobs/invalid-ticket").status_code == 404
    assert client.delete("/api/search/jobs/invalid-ticket").status_code == 404
    for patch in (
        {"ra": 360}, {"dec": -100}, {"size_arcmin": 0},
        {"detector": 7}, {"max_frames": 17}, {"ra": "nan"},
    ):
        request = payload()
        request.update(patch)
        assert client.post("/api/search/jobs", json=request).status_code == 422
    assert not tap.jobs


def test_demo_legacy_is_still_available(harness):
    client, tap = harness
    r = client.get("/api/search?demo=true")
    assert r.status_code == 200
    assert r.json()["source"] == "simulated"
    assert r.json()["count"] == 12
    assert not tap.jobs
