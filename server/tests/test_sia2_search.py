"""SIA2-first explorer: offline checks for safe direct preview and TAP separation."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app as explorer
from sia2_compare import Sia2ComparisonError


@pytest.fixture()
def harness(monkeypatch):
    submitted = []
    fake_tap = SimpleNamespace(
        submit_job=lambda *a, **kw: submitted.append((a, kw))
    )
    monkeypatch.setattr(explorer, "Irsa", SimpleNamespace(tap=fake_tap))
    with explorer._lock:
        explorer._tap_jobs.clear()
        explorer._sessions.clear()
    with TestClient(explorer.app) as client:
        yield client, submitted
    with explorer._lock:
        explorer._tap_jobs.clear()
        explorer._sessions.clear()


def body():
    return {
        "ra": 133.795129, "dec": -7.245147,
        "size_arcmin": 6, "detector": 2, "max_frames": 2,
    }


def record(number: int, mjd: float = 60801.5):
    return {
        "path": f"/ibe/data/spherex/dr1/level2/day/v1/2/level2_{number}.fits",
        "mjd": mjd,
        "date": "2025-05-06T02:33:29.894",
        "release": "DR1",
    }


def sia_records(rows, *, complete=True, matching=None):
    return {
        "elapsed_ms": 4094, "http_ms": 3923,
        "parse_ms": 160, "attempts": 1, "retry_events": [],
        "query_status": "OK" if complete else "OVERFLOW",
        "complete": complete, "matching_detector_rows": len(rows) if matching is None else matching,
        "valid_cutout_rows": len(rows), "radius_arcsec": 1.0,
        "records": rows,
    }


def test_sia2_search_returns_real_observation_session_without_tap(harness, monkeypatch):
    client, tap_submitted = harness
    rows = [record(1, 60801.5), record(2, 60802.5), record(3, 60803.5)]
    seen = []

    def query(ra, dec, size, detector):
        seen.append((ra, dec, size, detector))
        return sia_records(rows)

    monkeypatch.setattr(explorer, "query_sia2", query)
    response = client.post("/api/search/sia2", json=body())
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "sia2"
    assert payload["total_matches"] == 3
    assert payload["count"] == 2
    assert payload["discovery"]["method"] == "sia2"
    assert payload["discovery"]["elapsed_ms"] == 4094
    assert payload["discovery"]["usable_epoch_rows"] == 3
    assert payload["observations"][0]["mjd"] == 60801.5
    assert payload["observations"][-1]["mjd"] == 60803.5
    assert seen == [(133.795129, -7.245147, 6, 2)]
    assert not tap_submitted
    assert not explorer._tap_jobs

    session = explorer.get_session(payload["search_id"])
    assert session.source == "sia2"
    assert len(session.records) == 2
    assert "center=133.795129,-7.245147d&size=0.1" in session.records[0]["url"]
    assert explorer.ensure_irsa_cutout_url(session.records[0]["url"])

    monkeypatch.setattr(explorer, "render_real", lambda _session, _record: {
        "image": "data:image/png;base64,AAAA", "mode": "real",
        "wavelength_um": 1.2, "bandwidth_um": 0.03,
        "pixel_flags_nonzero_fraction": 0.1,
        "timing_ms": {"total": 1},
    })
    frame = client.get(f"/api/frame/{payload['search_id']}/0")
    assert frame.status_code == 200
    assert frame.json()["mode"] == "real"
    assert frame.json()["index"] == 0
    assert not tap_submitted


def test_sia2_usable_zero_does_not_start_tap(harness, monkeypatch):
    client, submitted = harness
    monkeypatch.setattr(explorer, "query_sia2", lambda *_: sia_records([]))
    response = client.post("/api/search/sia2", json=body())
    assert response.status_code == 200
    assert response.json()["count"] == 0
    assert response.json()["source"] == "sia2"
    assert submitted == []


def test_sia2_overflow_is_not_used_as_complete_catalog(harness, monkeypatch):
    client, submitted = harness
    monkeypatch.setattr(explorer, "query_sia2",
                        lambda *_: sia_records([record(1)], complete=False))
    response = client.post("/api/search/sia2", json=body())
    assert response.status_code == 503
    assert "incompleto" in response.json()["detail"]
    assert not submitted


def test_sia2_missing_valid_dates_is_not_misrepresented_as_empty(harness, monkeypatch):
    client, submitted = harness
    bad_record = record(1)
    bad_record["mjd"] = None
    bad_record["date"] = None
    monkeypatch.setattr(explorer, "query_sia2",
                        lambda *_: sia_records([bad_record]))
    response = client.post("/api/search/sia2", json=body())
    assert response.status_code == 502
    assert "ninguno" in response.json()["detail"]
    assert not submitted


def test_sia2_failure_does_not_create_tap_job(harness, monkeypatch):
    client, submitted = harness

    def unavailable(*_args):
        raise Sia2ComparisonError("IRSA SIA2 no respondió tras 3 intentos")

    monkeypatch.setattr(explorer, "query_sia2", unavailable)
    response = client.post("/api/search/sia2", json=body())
    assert response.status_code == 502
    assert "SIA2" in response.json()["detail"]
    assert submitted == []


def test_sia2_request_validation(harness, monkeypatch):
    client, submitted = harness
    called = []
    monkeypatch.setattr(explorer, "query_sia2", lambda *_: called.append(1))
    for change in (
        {"ra": 360}, {"dec": -91}, {"size_arcmin": 0},
        {"detector": 7}, {"max_frames": 17}, {"ra": "nan"},
    ):
        data = body()
        data.update(change)
        assert client.post("/api/search/sia2", json=data).status_code == 422
    assert called == []
    assert submitted == []
