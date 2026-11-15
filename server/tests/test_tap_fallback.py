"""IRSA fallback integration: SIA2 failures, TAP resume, no duplicate remote POST."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

import app as explorer
import persistent_sky as sky
import tap_discovery
from sia2_compare import Sia2ComparisonError
from social_api.models import SkySearchJob
from test_persistent_sky import harness, payload

def offline_sia2(*_args):
    raise Sia2ComparisonError("IRSA SIA2 devolvió HTTP 502 tras 3 intentos")


class RemoteTap:
    url = "https://irsa.ipac.caltech.edu/TAP/async/fallback-test-123"
    phase_status = "COMPLETED"

    def __init__(self):
        self.runs = 0
        self.fetches = 0

    def run(self):
        self.runs += 1

    @property
    def phase(self):
        return self.phase_status

    def fetch_result(self):
        self.fetches += 1
        return [
            {
                "uri": (
                    "https://irsa.ipac.caltech.edu/"
                    f"ibe/data/spherex/dr1/level2/a/b/frame{i}.fits"
                    "?center=133.795129,-7.245147d&size=0.1"
                ),
                "time_bounds_lower": 60810.0 + i,
            }
            for i in range(3)
        ]


def test_sia2_502_reuses_single_tap_async_job_and_renders_real_fits(harness, monkeypatch):
    client, maker, queries, saved = harness
    monkeypatch.setattr(explorer, "query_sia2", offline_sia2)
    remote = RemoteTap()
    submitted = []
    monkeypatch.setattr(tap_discovery, "_submit", lambda query: submitted.append(query) or remote)
    monkeypatch.setattr(tap_discovery, "_restore", lambda url: (_ for _ in ()).throw(
        AssertionError("No restore needed during uninterrupted job")
    ))
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    sky._run(uuid.UUID(data["job_id"]))
    state = client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert state["status"] == "complete", state
    assert state["source"] == "irsa"
    assert state["result"]["source"] == "irsa"
    assert state["result"]["count"] == 2
    assert state["discovery"]["method"] == "tap"
    assert state["discovery"]["fallback_from"] == "sia2"
    assert state["discovery"]["phase"] == "COMPLETED"
    assert "502" in state["discovery"]["sia2_error"]
    assert "_tap_job_url" not in state["discovery"]
    assert "_tap_submission_started" not in state["discovery"]
    assert "fallback-test-123" not in str(state)
    assert remote.runs == 1
    assert remote.fetches == 1
    assert len(submitted) == 1
    assert "spherex.artifact" in submitted[0]
    assert not queries
    assert len(saved) == 2
    assert all(row["status"] == "ready" for row in state["frames"])


def test_failed_tap_submission_is_not_blindly_retried_after_restart(harness, monkeypatch):
    client, maker, *_ = harness
    monkeypatch.setattr(explorer, "query_sia2", offline_sia2)
    submitted = []
    def fail_submit(_query):
        submitted.append(True)
        raise RuntimeError("ambiguous HTTP 502 from remote")
    monkeypatch.setattr(tap_discovery, "_submit", fail_submit)
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    job = uuid.UUID(data["job_id"])
    sky._run(job)
    failed = client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert failed["status"] == "failed"
    assert "SIA2" in failed["error"] and "TAP" in failed["error"]
    assert "no se reintentó" in failed["error"].lower()
    assert "_tap_submission_started" not in failed["discovery"]
    assert len(submitted) == 1

    with maker() as db:
        row=db.get(SkySearchJob,job)
        assert row.discovery_data["_tap_submission_started"]
        assert "_tap_job_url" not in row.discovery_data
        # Simulate a worker restart/reclaim; must NOT repeat ambiguous POST.
        row.status="queued"
        row.lease_owner=None
        row.lease_until=None
        db.commit()
    sky._run(job)
    assert len(submitted) == 1
    again = client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert again["status"] == "failed"
    assert "duplicado" in again["error"]


def test_known_tap_url_is_resumed_without_new_submission(harness, monkeypatch):
    client, maker, *_ = harness
    monkeypatch.setattr(explorer, "query_sia2", offline_sia2)
    monkeypatch.setattr(tap_discovery, "POLL_INTERVAL_SECONDS", 0)
    remote=RemoteTap()
    submits = []
    restored = []
    monkeypatch.setattr(tap_discovery, "_submit", lambda q: submits.append(q) or remote)
    def failing_phase():
        raise RuntimeError("IRSA proxy 502")
    # First execution loses the ability to poll, but the URL is persisted.
    remote.phase_status = "FAILED_POLL"
    original_phase = RemoteTap.phase
    monkeypatch.setattr(RemoteTap, "phase", property(
        lambda obj: failing_phase() if obj.phase_status == "FAILED_POLL" else obj.phase_status
    ))
    monkeypatch.setattr(tap_discovery, "_restore", lambda url: restored.append(url) or remote)
    data = payload()
    assert client.post("/api/sky/jobs", json=data).status_code == 202
    job=uuid.UUID(data["job_id"])
    sky._run(job)
    state=client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert state["status"] == "failed"
    assert len(submits) == 1

    remote.phase_status = "COMPLETED"
    with maker() as db:
        row=db.get(SkySearchJob,job)
        assert row.discovery_data["_tap_job_url"] == remote.url
        row.status="queued"
        row.lease_owner=None
        row.lease_until=None
        db.commit()
    sky._run(job)
    state=client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert state["status"] == "complete", state
    assert len(submits) == 1
    assert restored == [remote.url]
    assert remote.runs == 1


def test_fake_remote_job_url_rejected_and_not_leaked(harness, monkeypatch):
    client, _, *_ = harness
    monkeypatch.setattr(explorer, "query_sia2", offline_sia2)
    remote=RemoteTap()
    remote.url="https://evil.example.net/TAP/async/invalid"
    monkeypatch.setattr(tap_discovery, "_submit", lambda _:remote)
    data=payload()
    assert client.post("/api/sky/jobs",json=data).status_code==202
    sky._run(uuid.UUID(data["job_id"]))
    state=client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert state["status"]=="failed"
    assert "identificador seguro" in state["error"]
    assert "evil.example" not in str(state)


def test_sia2_success_never_submits_tap(harness, monkeypatch):
    client, _, queries, _ = harness
    monkeypatch.setattr(tap_discovery, "_submit", lambda _: (_ for _ in ()).throw(
        AssertionError("SIA2 succeeded; TAP must not be called")
    ))
    data=payload()
    assert client.post("/api/sky/jobs",json=data).status_code==202
    sky._run(uuid.UUID(data["job_id"]))
    state=client.get("/api/sky/jobs/"+data["job_id"]).json()
    assert state["source"]=="sia2"
    assert state["status"]=="complete"
    assert len(queries)==1
