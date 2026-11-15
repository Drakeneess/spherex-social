"""Durable, tab-independent astronomical exploration.

A search UUID is an unguessable capability. The client may retry POST with
the same UUID without submitting another remote search. The server owns all
catalog and FITS work; browser disconnects never cancel it. PostgreSQL stores
progress and metadata, private S3 stores rendered PNGs. No time-based expiry.
"""
from __future__ import annotations

import logging
import math
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from social_api.db import get_session_factory
from social_api.models import SkySearchJob
from sky_storage import get_preview, put_preview, put_science, get_science_pixels
from sky_reveal import RevealRecipe, reveal_png

router = APIRouter(prefix="/api/sky/jobs", tags=["persistent sky exploration"])
logger = logging.getLogger("astrogram.sky.persistent")
ACTIVE = ("queued", "catalog", "frames")
TERMINAL = ("complete", "partial", "empty", "failed", "cancelled")
MAX_ACTIVE_JOBS = 12
LEASE_SECONDS = 120
POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sky-catalog")
_running_ids: set[uuid.UUID] = set()
_running_lock = threading.Lock()
_dispatcher_running = False


class SearchRequest(BaseModel):
    job_id: uuid.UUID
    ra: float = Field(ge=0, lt=360, allow_inf_nan=False)
    dec: float = Field(ge=-90, le=90, allow_inf_nan=False)
    size_arcmin: float = Field(ge=1, le=12, allow_inf_nan=False)
    detector: int = Field(ge=1, le=6)
    max_frames: int = Field(ge=2, le=16)
    demo: bool = False


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _factory():
    return get_session_factory()


def _iso_utc(value: datetime) -> str:
    # SQLite tests can return naive UTC timestamps; production is timestamptz.
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _snapshot(row: SkySearchJob) -> dict:
    frames = row.frame_states or []
    return {
        "job_id": str(row.id), "status": row.status, "source": row.source,
        "created_at": _iso_utc(row.created_at),
        "updated_at": _iso_utc(row.updated_at),
        "query": {
            "ra": row.ra, "dec": row.dec, "size_arcmin": row.size_arcmin,
            "detector": row.detector, "max_frames": row.max_frames,
            "demo": row.demo,
        },
        "total_matches": row.total_matches,
        "result": row.result_data,
        "discovery": row.discovery_data,
        "frames": [
            {"index": item["index"], "status": item["status"],
             **({"error": "Imagen no disponible"} if item["status"] == "failed" else {})}
            for item in frames
        ],
        "error": row.error_message if row.status == "failed" else None,
    }


def _row(job_id: uuid.UUID):
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        if row is None:
            raise HTTPException(status_code=404, detail="No se encontró la búsqueda")
        return _snapshot(row)


@router.post("", status_code=202)
def create_job(payload: SearchRequest):
    with _factory()() as db:
        existing = db.get(SkySearchJob, payload.job_id)
        if existing:
            expected = (payload.ra, payload.dec, payload.size_arcmin,
                        payload.detector, payload.max_frames, payload.demo)
            actual = (existing.ra, existing.dec, existing.size_arcmin,
                      existing.detector, existing.max_frames, existing.demo)
            if expected != actual:
                raise HTTPException(status_code=409, detail="El identificador ya pertenece a otra búsqueda")
            return JSONResponse(_snapshot(existing), status_code=200,
                                headers={"Cache-Control": "private, no-store"})
        active_count = db.scalar(select(func.count()).select_from(SkySearchJob).where(
            SkySearchJob.status.in_(ACTIVE),
        )) or 0
        if active_count >= MAX_ACTIVE_JOBS:
            raise HTTPException(status_code=429, detail="Hay demasiadas búsquedas en curso")
        row = SkySearchJob(
            id=payload.job_id, ra=payload.ra, dec=payload.dec,
            size_arcmin=payload.size_arcmin, detector=payload.detector,
            max_frames=payload.max_frames, demo=payload.demo,
            status="queued", source="simulated" if payload.demo else "sia2",
            frame_states=[],
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # A concurrent tab may have created exactly the same UUID.
            existing = db.get(SkySearchJob, payload.job_id)
            if existing is None:
                raise
            expected = (payload.ra, payload.dec, payload.size_arcmin,
                        payload.detector, payload.max_frames, payload.demo)
            actual = (existing.ra, existing.dec, existing.size_arcmin,
                      existing.detector, existing.max_frames, existing.demo)
            if expected != actual:
                raise HTTPException(status_code=409, detail="La búsqueda cambió durante su creación")
            return JSONResponse(_snapshot(existing), status_code=200,
                                headers={"Cache-Control": "private, no-store"})
        db.refresh(row)
        state = _snapshot(row)
    _schedule(payload.job_id)
    return JSONResponse(state, status_code=202, headers={"Cache-Control": "private, no-store"})


@router.get("/{job_id}")
def get_job(job_id: uuid.UUID):
    return JSONResponse(_row(job_id), headers={"Cache-Control": "private, no-store"})


@router.get("/{job_id}/frames/{index}")
def get_job_frame(job_id: uuid.UUID, index: int):
    snapshot = _row(job_id)
    frames = snapshot["frames"]
    if index < 0 or index >= len(frames) or frames[index]["status"] != "ready":
        raise HTTPException(status_code=404, detail="La imagen aún no está disponible")
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        data = next((item for item in row.frame_states or [] if item["index"] == index), None)
        if not data or data["status"] != "ready":
            raise HTTPException(status_code=404, detail="La imagen aún no está disponible")
        meta = data.get("metadata") or {}
    try:
        image = get_preview(job_id, index)
    except Exception as exc:
        logger.warning("Could not read stored sky frame: %s", type(exc).__name__, exc_info=True)
        raise HTTPException(status_code=503, detail="La imagen no está disponible temporalmente") from exc
    return JSONResponse({**meta, "image": image}, headers={"Cache-Control": "private, no-store"})


@router.post("/{job_id}/frames/{index}/reveal")
def reveal_job_frame(job_id: uuid.UUID, index: int, recipe: RevealRecipe):
    """Preview a nondestructive display recipe against original saved pixels.

    This route uses the same unguessable job capability as the frame PNG API.
    It never returns FITS/float arrays, S3 keys, or credentials.
    """
    snapshot = _row(job_id)
    if index < 0 or index >= len(snapshot["frames"]) or snapshot["frames"][index]["status"] != "ready":
        raise HTTPException(status_code=404, detail="La época todavía no está disponible")
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        item = next((entry for entry in row.frame_states or []
                     if entry["index"] == index), None)
        if row.demo or not item or not (item.get("metadata") or {}).get("raw_available"):
            raise HTTPException(status_code=409,
                                detail="Esta época no tiene datos científicos editables. Inicia una nueva búsqueda real.")
    try:
        pixels = get_science_pixels(job_id, index)
        image = reveal_png(pixels, recipe)
    except Exception as exc:
        logger.warning("Reveal frame unavailable: %s", type(exc).__name__, exc_info=True)
        raise HTTPException(status_code=503,
                            detail="No se pudo recuperar el revelado") from exc
    return JSONResponse({"image": image, "recipe": recipe.model_dump(mode="json"),
                         "derived": True, "source": "SPHEREx FITS reproyectado"},
                        headers={"Cache-Control": "private, no-store"})


@router.delete("/{job_id}", status_code=204)
def cancel_job(job_id: uuid.UUID):
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        if row is None:
            raise HTTPException(status_code=404, detail="No se encontró la búsqueda")
        if row.status in ACTIVE:
            row.status = "cancelled"
            row.updated_at = utcnow()
            row.lease_owner = None
            row.lease_until = None
            db.commit()
    return None


class JobStopped(Exception):
    """Job was cancelled or its lease moved to another worker."""


def _write(job_id: uuid.UUID, worker: str, **changes):
    # Atomic owner check: never resurrect a search cancelled in another tab.
    changes["updated_at"] = utcnow()
    changes["lease_until"] = utcnow() + timedelta(seconds=LEASE_SECONDS)
    with _factory()() as db:
        result = db.execute(
            update(SkySearchJob).where(
                SkySearchJob.id == job_id,
                SkySearchJob.lease_owner == worker,
                SkySearchJob.status.in_(ACTIVE),
            ).values(**changes)
        )
        db.commit()
        if not result.rowcount:
            raise JobStopped()


def _claim(job_id: uuid.UUID, worker: str) -> bool:
    now = utcnow()
    with _factory()() as db:
        result = db.execute(update(SkySearchJob).where(
            SkySearchJob.id == job_id,
            SkySearchJob.status.in_(ACTIVE),
            or_(SkySearchJob.lease_until.is_(None), SkySearchJob.lease_until < now),
        ).values(lease_owner=worker, lease_until=now + timedelta(seconds=LEASE_SECONDS)))
        db.commit()
        return result.rowcount == 1


def _heartbeat(job_id: uuid.UUID, worker: str, done: threading.Event):
    while not done.wait(20):
        try:
            with _factory()() as db:
                db.execute(update(SkySearchJob).where(
                    SkySearchJob.id == job_id,
                    SkySearchJob.lease_owner == worker,
                    SkySearchJob.status.in_(ACTIVE),
                ).values(lease_until=utcnow() + timedelta(seconds=LEASE_SECONDS)))
                db.commit()
        except Exception:
            logger.warning("Sky worker heartbeat failed", exc_info=True)


def _discover(row: SkySearchJob) -> tuple[list[dict], dict, dict]:
    from app import (demo_records, evenly_spaced, ensure_irsa_cutout_url,
                     query_sia2)
    if row.demo:
        all_records = demo_records()
        discovery = {"method": "simulated"}
    else:
        sia = query_sia2(row.ra, row.dec, row.size_arcmin, row.detector)
        if not sia["complete"]:
            raise ValueError("El catálogo devolvió resultados incompletos")
        all_records = []
        for item in sia["records"]:
            mjd = item.get("mjd")
            if mjd is None or not math.isfinite(mjd) or not item.get("date"):
                continue
            url = ("https://irsa.ipac.caltech.edu" + item["path"]
                   + f"?center={row.ra},{row.dec}d&size={row.size_arcmin / 60}")
            if not ensure_irsa_cutout_url(url):
                continue
            all_records.append({
                "url": url, "mjd": mjd, "date": item["date"],
                "release": item["release"],
            })
        if sia["matching_detector_rows"] and not all_records:
            raise ValueError("El catálogo no devolvió imágenes utilizables")
        all_records.sort(key=lambda item: item["mjd"])
        discovery = {
            "method": "sia2", "elapsed_ms": sia["elapsed_ms"],
            "query_status": sia["query_status"],
            "attempts": sia["attempts"],
        }
    selected = evenly_spaced(all_records, row.max_frames)
    result = {
        "search_id": str(row.id),
        "source": "simulated" if row.demo else "sia2",
        "total_matches": len(all_records), "count": len(selected),
        "ra": row.ra, "dec": row.dec, "detector": row.detector,
        "observations": [
            {"index": i, "date": item["date"],
             "release": item["release"], "mjd": item["mjd"]}
            for i, item in enumerate(selected)
        ],
    }
    return selected, result, discovery


def _produce_frame(job_id: uuid.UUID, row: SkySearchJob, records: list[dict], index: int):
    from app import (FrameProcessingError, FITS_RETRY_DELAYS, MAX_FITS_ATTEMPTS,
                     Session as PreviewSession, generate_demo, render_real)
    if row.demo:
        rendered = generate_demo(index, len(records))
    else:
        session = PreviewSession(
            row.ra, row.dec, row.size_arcmin,
            row.detector, records, "sia2",
        )
        for attempt in range(1, MAX_FITS_ATTEMPTS + 1):
            try:
                rendered = render_real(session, records[index])
                break
            except FrameProcessingError as exc:
                if not exc.transient or attempt == MAX_FITS_ATTEMPTS:
                    raise
                time.sleep(FITS_RETRY_DELAYS[attempt - 1])
    image = rendered.pop("image")
    raw_fits = rendered.pop("science_fits", None)
    raw_pixels = rendered.pop("science_pixels", None)
    raw_available = False
    if raw_fits is not None and raw_pixels is not None:
        # Store the scientific source before declaring the frame complete.
        # This is an immutable job/index namespace, never a user's filename.
        put_science(job_id, index, raw_fits, raw_pixels)
        raw_available = True
    put_preview(job_id, index, image)
    return {
        **rendered, "raw_available": raw_available, "index": index,
        "date": records[index]["date"],
        "release": records[index]["release"],
    }


def _process(job_id: uuid.UUID, worker: str):
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        if row is None or row.status not in ACTIVE:
            return
        if row.records_data is None:
            _write(job_id, worker, status="catalog")
            records, result, discovery = _discover(row)
            initial = [{"index": i, "status": "pending"} for i in range(len(records))]
            _write(job_id, worker, records_data=records, result_data=result,
                   discovery_data=discovery, total_matches=result["total_matches"],
                   frame_states=initial,
                   status="frames" if records else "empty")
            if not records:
                return
        else:
            records = row.records_data

    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        if row is None or row.status not in ACTIVE:
            return
        states = [dict(item) for item in (row.frame_states or [])]
        # Unfinished frames can be retried after worker restart. Previously
        # completed objects are never downloaded again.
        todo = [i for i, state in enumerate(states) if state["status"] != "ready"]
        if not todo:
            final = "complete" if states else "empty"
            _write(job_id, worker, status=final)
            return
        _write(job_id, worker, status="frames")

    # Only workers render and upload FITS; persistence updates stay serialized.
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="sky-frame") as pool:
        futures = {pool.submit(_produce_frame, job_id, row, records, i): i for i in todo}
        for future in as_completed(futures):
            index = futures[future]
            try:
                meta = future.result()
                states[index] = {"index": index, "status": "ready", "metadata": meta}
            except Exception as exc:
                logger.warning("Sky frame %s failed: %s", index, type(exc).__name__)
                states[index] = {"index": index, "status": "failed"}
            _write(job_id, worker, frame_states=[dict(item) for item in states])

    successes = sum(item["status"] == "ready" for item in states)
    final = "complete" if successes == len(states) else "partial" if successes else "failed"
    _write(job_id, worker, status=final,
           error_message="No se pudieron recuperar las imágenes" if not successes else None)


def _run(job_id: uuid.UUID):
    worker = uuid.uuid4().hex
    if not _claim(job_id, worker):
        return
    stopped = threading.Event()
    thread = threading.Thread(target=_heartbeat, args=(job_id, worker, stopped), daemon=True)
    thread.start()
    try:
        _process(job_id, worker)
    except JobStopped:
        pass
    except Exception as exc:
        logger.warning("Persistent sky search failed %s: %s", job_id, type(exc).__name__,
                       exc_info=True)
        try:
            _write(job_id, worker, status="failed",
                   error_message="No se pudo completar la búsqueda astronómica")
        except JobStopped:
            pass
    finally:
        stopped.set()
        with _factory()() as db:
            db.execute(update(SkySearchJob).where(
                SkySearchJob.id == job_id, SkySearchJob.lease_owner == worker,
            ).values(lease_owner=None, lease_until=None))
            db.commit()


def _wrapped_run(job_id: uuid.UUID):
    try:
        _run(job_id)
    finally:
        with _running_lock:
            _running_ids.discard(job_id)


def _schedule(job_id: uuid.UUID):
    with _running_lock:
        if job_id in _running_ids:
            return
        _running_ids.add(job_id)
    POOL.submit(_wrapped_run, job_id)


def _dispatch_loop():
    while True:
        try:
            now = utcnow()
            with _factory()() as db:
                jobs = db.scalars(select(SkySearchJob.id).where(
                    SkySearchJob.status.in_(ACTIVE),
                    or_(SkySearchJob.lease_until.is_(None),
                        SkySearchJob.lease_until < now),
                ).limit(24)).all()
            for job_id in jobs:
                _schedule(job_id)
        except Exception:
            logger.warning("Persistent sky dispatcher failed", exc_info=True)
        time.sleep(10)


def start_dispatcher():
    global _dispatcher_running
    if os.environ.get("PYTEST_CURRENT_TEST"):
        # Tests invoke _run synchronously with isolated SQLite databases.
        return
    with _running_lock:
        if _dispatcher_running:
            return
        _dispatcher_running = True
    threading.Thread(target=_dispatch_loop, name="sky-dispatcher", daemon=True).start()
