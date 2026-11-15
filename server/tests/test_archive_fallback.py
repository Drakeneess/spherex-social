"""IRSA offline mode must reuse only exact public science searches, privately.

These are real archived FITS/PNG assets, not fake substitute observations.
"""
from __future__ import annotations

import uuid
import numpy as np

import app as explorer
import persistent_sky as sky
import sky_storage
import tap_discovery
import social_api.db as db_module
from sia2_compare import Sia2ComparisonError
from social_api.models import SkySearchJob
from test_persistent_sky import harness, payload


def unavailable_sia2(*_args):
    raise Sia2ComparisonError("IRSA SIA2 devolvió HTTP 502 tras 3 intentos")


def unreachable_tap(_query):
    raise RuntimeError("IRSA TAP async returned an ambiguous HTTP 502")


def _create_completed(client, payload_data):
    assert client.post("/api/sky/jobs", json=payload_data).status_code == 202
    sky._run(uuid.UUID(payload_data["job_id"]))
    state=client.get("/api/sky/jobs/"+payload_data["job_id"]).json()
    assert state["status"] == "complete", state
    return state


def test_archive_survives_double_502_without_more_fits_downloads(harness, monkeypatch, tmp_path):
    client, maker, queried, saved = harness
    original=payload()
    _create_completed(client, original)
    assert len(saved) == 2
    assert len(queried) == 1

    # Confirm storage can find the original private FITS and PNG assets.
    monkeypatch.setenv("APP_ENV","development")
    monkeypatch.setattr(sky_storage,"LOCAL_STORE",tmp_path / "cached-sky")
    monkeypatch.setattr(db_module,"get_session_factory",lambda:maker)
    from sky_storage import get_preview, put_preview, put_science
    first_image=saved[(original["job_id"],0)]
    put_preview(uuid.UUID(original["job_id"]),0,first_image)
    original_fits=b"SIMPLE  "+b"0"*20
    original_pixels=np.ones((4,4),dtype=np.float32)
    put_science(uuid.UUID(original["job_id"]),0,original_fits,original_pixels)

    monkeypatch.setattr(explorer,"query_sia2",unavailable_sia2)
    monkeypatch.setattr(tap_discovery,"_submit",unreachable_tap)
    next_data=payload()
    assert next_data["job_id"] != original["job_id"]
    assert client.post("/api/sky/jobs",json=next_data).status_code==202
    sky._run(uuid.UUID(next_data["job_id"]))
    state=client.get("/api/sky/jobs/"+next_data["job_id"]).json()
    assert state["status"] == "complete",state
    assert state["job_id"]==next_data["job_id"]
    assert state["result"]["search_id"] == next_data["job_id"]
    assert state["discovery"]["method"]=="archive"
    assert state["discovery"]["fallback_from"]=="sia2+tap"
    assert state["source"]=="sia2"
    assert "archive_date" not in state["discovery"]  # Do not disclose past search activity
    assert "502" not in str(state["discovery"])  # only archival provenance, no remote error
    assert original["job_id"] not in str(state)
    assert "_archive_source_job" not in str(state)
    assert all(item["status"]=="ready" for item in state["frames"])
    assert len(saved)==2  # no extra renders/downloads/uploads

    # An archive-backed new job resolves original immutable private assets
    # without disclosing the source job's unguessable capability.
    alias=uuid.UUID(next_data["job_id"])
    assert sky_storage._archive_asset_source(alias)==uuid.UUID(original["job_id"])
    assert get_preview(alias,0)==first_image
    assert np.array_equal(sky_storage.get_science_pixels(alias,0),original_pixels)
    assert sky_storage.get_source_fits(alias,0)==original_fits
    assert not (sky_storage.LOCAL_STORE / "sky" / "v1" / next_data["job_id"]).exists()


def test_archive_only_reuses_identical_region_detector_fov_and_epoch_count(harness, monkeypatch):
    client, _, _, _ = harness
    original=payload()
    _create_completed(client,original)
    monkeypatch.setattr(explorer,"query_sia2",unavailable_sia2)
    monkeypatch.setattr(tap_discovery,"_submit",unreachable_tap)
    for change in (
        {"ra":133.795130},{"dec":-7.245148},{"size_arcmin":7},
        {"detector":3},{"max_frames":3},
    ):
        alternative=payload(**change)
        assert client.post("/api/sky/jobs",json=alternative).status_code==202
        sky._run(uuid.UUID(alternative["job_id"]))
        state=client.get("/api/sky/jobs/"+alternative["job_id"]).json()
        assert state["status"]=="failed", (change,state)
        assert "IRSA" in state["error"]
        assert state["discovery"]["method"]=="tap"
        assert "_archive_source_job" not in str(state)


def test_archives_never_leak_source_capability_or_reuse_simulations(harness, monkeypatch):
    client, _, _, _ = harness
    demo=payload(demo=True)
    _create_completed(client,demo)
    monkeypatch.setattr(explorer,"query_sia2",unavailable_sia2)
    monkeypatch.setattr(tap_discovery,"_submit",unreachable_tap)
    query=payload()
    assert client.post("/api/sky/jobs",json=query).status_code==202
    sky._run(uuid.UUID(query["job_id"]))
    state=client.get("/api/sky/jobs/"+query["job_id"]).json()
    assert state["status"]=="failed"
    assert state["discovery"]["method"]=="tap"
    assert demo["job_id"] not in str(state)


def test_sia2_success_still_prefers_live_discovery_over_archives(harness, monkeypatch):
    client, _, queries, _ = harness
    _create_completed(client,payload())
    remote=[]
    monkeypatch.setattr(tap_discovery,"_submit",lambda q:remote.append(q))
    second=payload()
    assert client.post("/api/sky/jobs",json=second).status_code==202
    sky._run(uuid.UUID(second["job_id"]))
    state=client.get("/api/sky/jobs/"+second["job_id"]).json()
    assert state["status"]=="complete"
    assert state["discovery"]["method"]=="sia2"
    assert len(queries)==2
    assert not remote
