"""Mock IRSA TAP async lifecycle; no external services in CI."""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pyvo.dal import DALServiceError
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


def test_transient_502_poll_retries_without_deleting_remote_job(harness, monkeypatch):
    client, tap = harness
    ticket = client.post("/api/search/jobs", json=payload()).json()["job_id"]
    remote = tap.jobs[0]
    outcomes = [DALServiceError("Proxy Error", code=502), "EXECUTING"]

    def flaky_phase(_self):
        value = outcomes.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(FakeRemoteJob, "phase", property(flaky_phase), raising=False)
    failed_poll = client.get(f"/api/search/jobs/{ticket}")
    assert failed_poll.status_code == 200
    state = failed_poll.json()
    assert state["phase"] == "RETRYING"
    assert state["retry_after_seconds"] >= 3
    assert state["attempt"] == 1
    assert not remote.aborted
    assert not remote.deleted

    # The API does not hit IRSA again until the retry window is over.
    waiting = client.get(f"/api/search/jobs/{ticket}")
    assert waiting.status_code == 200
    assert waiting.json()["phase"] == "RETRYING"
    assert len(outcomes) == 1

    explorer.get_tap_job(ticket).retry_at = 0
    recovered = client.get(f"/api/search/jobs/{ticket}")
    assert recovered.status_code == 200
    assert recovered.json()["phase"] == "EXECUTING"
    assert explorer.get_tap_job(ticket).consecutive_errors == 0


def test_persistent_502_poll_fails_after_bounded_retries(harness, monkeypatch):
    client, tap = harness
    ticket = client.post("/api/search/jobs", json=payload()).json()["job_id"]

    def always_unavailable(_self):
        raise DALServiceError("Proxy Error", code=502)

    monkeypatch.setattr(FakeRemoteJob, "phase", property(always_unavailable), raising=False)
    job = explorer.get_tap_job(ticket)
    for n in range(explorer.MAX_CONSECUTIVE_TAP_ERRORS):
        job.retry_at = 0
        result = client.get(f"/api/search/jobs/{ticket}")
        assert result.status_code == 200
        assert result.json()["phase"] == "RETRYING"
        assert result.json()["attempt"] == n + 1

    job.retry_at = 0
    final = client.get(f"/api/search/jobs/{ticket}")
    assert final.status_code == 503
    assert "IRSA" in final.json()["detail"]


def test_nonretryable_remote_phase_failure_is_not_masked(harness, monkeypatch):
    client, _tap = harness
    ticket = client.post("/api/search/jobs", json=payload()).json()["job_id"]

    def bad_job(_self):
        raise DALServiceError("Invalid job", code=404)

    monkeypatch.setattr(FakeRemoteJob, "phase", property(bad_job), raising=False)
    result = client.get(f"/api/search/jobs/{ticket}")
    assert result.status_code == 502
    assert explorer.get_tap_job(ticket).consecutive_errors == 0


def test_result_502_does_not_reset_error_counter_on_each_successful_phase(harness, monkeypatch):
    client, tap = harness
    ticket = client.post("/api/search/jobs", json=payload()).json()["job_id"]
    remote = tap.jobs[0]
    remote.phase = "COMPLETED"
    original = remote.fetch_result
    calls = 0

    def temporary_result_failure():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise DALServiceError("Proxy Error", code=502)
        return original()

    monkeypatch.setattr(remote, "fetch_result", temporary_result_failure)
    first = client.get(f"/api/search/jobs/{ticket}")
    assert first.status_code == 200
    assert first.json()["phase"] == "RETRYING"
    assert explorer.get_tap_job(ticket).consecutive_errors == 1

    explorer.get_tap_job(ticket).retry_at = 0
    second = client.get(f"/api/search/jobs/{ticket}")
    assert second.status_code == 200
    assert second.json()["phase"] == "COMPLETED"
    assert calls == 2
