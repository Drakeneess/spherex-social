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
import numpy as np
import threading
import time
from functools import lru_cache
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
from sky_candidate_search import analyze_motion
from sia2_compare import Sia2ComparisonError
from tap_discovery import TapFallbackError, retrieve_tap_catalog

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
        "discovery": {
            key: value for key, value in (row.discovery_data or {}).items()
            if not key.startswith("_")
        } if row.discovery_data else None,
        "frames": [
            {"index": item["index"], "status": item["status"],
             "raw_available": bool((item.get("metadata") or {}).get("raw_available")),
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


# Candidate analysis is explicit and read-only. A bounded worker guard and an LRU
# on immutable terminal jobs avoid expensive repeated S3 reads across visits.
_candidate_slots = threading.BoundedSemaphore(2)


@lru_cache(maxsize=24)
def _analyze_terminal_job(job_id: uuid.UUID) -> dict:
    with _factory()() as db:
        job = db.get(SkySearchJob, job_id)
        if job is None or job.status not in ("complete", "partial"):
            raise HTTPException(status_code=409, detail="La búsqueda aún no terminó")
        if job.demo or job.source == "simulated":
            raise HTTPException(status_code=422, detail="Las imágenes simuladas no admiten análisis científico")
        observations = (job.result_data or {}).get("observations", [])
        timestamps = {
            item["index"]: item.get("mjd")
            for item in observations
            if isinstance(item, dict) and isinstance(item.get("index"), int)
        }
        indices = [
            item["index"]
            for item in (job.frame_states or [])
            if item.get("status") == "ready"
            and (item.get("metadata") or {}).get("raw_available")
            and isinstance(timestamps.get(item.get("index")), (int, float))
        ]
        query_ra, query_dec = job.ra, job.dec
        total = len(job.frame_states or [])
    frames = []
    skipped = 0
    for index in indices:
        try:
            pixels = get_science_pixels(job_id, index)
            # Edge cutouts can lack most of their footprint. Exclude them
            # rather than failing every otherwise-usable science frame.
            finite = np.isfinite(pixels)
            if float(np.count_nonzero(finite)) / pixels.size < 0.65:
                skipped += 1
                continue
            frames.append((index, float(timestamps[index]), pixels))
        except Exception:
            skipped += 1
            logger.warning("Sky candidate search skipped unreadable FITS reprojection")
    result = analyze_motion(frames, query_ra, query_dec)
    return {
        "job_id": str(job_id),
        "method": "registered-FITS-temporal-tracklets-v1",
        "frames_total": total,
        "frames_skipped": skipped,
        **result,
        "limitations": [
            "Solo señala trayectorias preliminares; no confirma objetos ni Planet X.",
            "Sin ajuste de PSF, ruido instrumental ni respuesta espectral por época.",
            "No compara con asteroides catalogados ni realiza ajuste orbital.",
            "Una búsqueda sin candidatos no descarta movimientos débiles o lentos.",
        ],
    }


@router.get("/{job_id}/candidates")
def get_moving_candidates(job_id: uuid.UUID):
    """Bounded, no-upload-on-read motion search using stored float FITS pixels."""
    with _factory()() as db:
        row = db.get(SkySearchJob, job_id)
        if row is None:
            raise HTTPException(status_code=404, detail="No se encontró la búsqueda")
        if row.demo or row.source == "simulated":
            raise HTTPException(status_code=422, detail="Se necesitan observaciones reales")
        if row.status not in ("complete", "partial"):
            raise HTTPException(status_code=409, detail="La búsqueda debe terminar antes de analizar movimiento")
    if not _candidate_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Hay análisis en curso. Inténtalo de nuevo.")
    try:
        output = _analyze_terminal_job(job_id)
    finally:
        _candidate_slots.release()
    return JSONResponse(output, headers={"Cache-Control": "private, no-store"})


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


def _archived_catalog(row: SkySearchJob) -> tuple[list[dict], dict, str] | None:
    """Find public science images for the exact query, without exposing a job UUID.

    Previous jobs are immutable after completion. Only real observations,
    exactly matching all 5 spatial/detector/epoch parameters, may be reused.
    This lookup is internal; clients never learn another search capability.
    """
    with _factory()() as db:
        matches = db.scalars(
            select(SkySearchJob).where(
                SkySearchJob.ra == row.ra,
                SkySearchJob.dec == row.dec,
                SkySearchJob.size_arcmin == row.size_arcmin,
                SkySearchJob.detector == row.detector,
                SkySearchJob.max_frames == row.max_frames,
                SkySearchJob.demo.is_(False),
                SkySearchJob.status.in_(("complete", "partial")),
                SkySearchJob.source.in_(("sia2", "irsa")),
            ).order_by(SkySearchJob.updated_at.desc()).limit(12)
        ).all()
        for previous in matches:
            if previous.id == row.id:
                continue
            if (previous.discovery_data or {}).get("_archive_source_job"):
                continue  # Avoid chains of archived aliases.
            records = previous.records_data or []
            states = previous.frame_states or []
            if (not records or len(states) != len(records)
                    or not any(item.get("status") == "ready" for item in states)):
                continue
            if not previous.result_data or previous.result_data.get("count") != len(records):
                continue
            metadata = {
                "method": "archive",
                "fallback_from": "sia2+tap",
                "archive_date": _iso_utc(previous.updated_at),
                "catalog_source": previous.source,
                "_archive_source_job": str(previous.id),
            }
            return [dict(item) for item in records], metadata, previous.source
    return None


def _discover(row: SkySearchJob, worker: str) -> tuple[list[dict], dict, dict]:
    from app import (demo_records, evenly_spaced, ensure_irsa_cutout_url,
                     query_sia2)

    if row.demo:
        all_records = demo_records()
        discovery = {"method": "simulated"}
        source = "simulated"
    else:
        # Persist TAP intent before the remote POST. On restart, recover the
        # same UWS URL and NEVER create a duplicate job in response to a 502.
        previous = row.discovery_data or {}

        def persist_tap(state: dict):
            _write(row.id, worker, source="irsa", discovery_data=state)

        if previous.get("_tap_submission_started"):
            try:
                all_records, discovery = retrieve_tap_catalog(
                    row.ra, row.dec, row.size_arcmin, row.detector,
                    previous, persist_tap,
                )
            except TapFallbackError:
                archived = _archived_catalog(row)
                if archived is None:
                    raise
                all_records, discovery, _ = archived
                logger.info("Using archived sky observation catalog after TAP failed")
        else:
            try:
                sia = query_sia2(row.ra, row.dec, row.size_arcmin, row.detector)
                if not sia["complete"]:
                    raise Sia2ComparisonError(
                        "SIA2 devolvió un resultado incompleto o truncado"
                    )
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
                    raise Sia2ComparisonError(
                        "SIA2 no devolvió imágenes válidas para el detector"
                    )
                all_records.sort(key=lambda item: item["mjd"])
                discovery = {
                    "method": "sia2", "elapsed_ms": sia["elapsed_ms"],
                    "query_status": sia["query_status"],
                    "attempts": sia["attempts"],
                }
            except Sia2ComparisonError as exc:
                logger.warning(
                    "SIA2 catalog unavailable, trying TAP async fallback: %s",
                    str(exc)[:150],
                )
                try:
                    all_records, discovery = retrieve_tap_catalog(
                        row.ra, row.dec, row.size_arcmin, row.detector,
                        previous, persist_tap, sia2_failure=str(exc),
                    )
                except TapFallbackError:
                    archived = _archived_catalog(row)
                    if archived is None:
                        raise
                    all_records, discovery, _ = archived
                    logger.info("Using archived sky observations after SIA2 and TAP failed")
        source = (discovery["catalog_source"] if discovery["method"] == "archive"
                  else "sia2" if discovery["method"] == "sia2" else "irsa")

    selected = evenly_spaced(all_records, row.max_frames)
    result = {
        "search_id": str(row.id),
        "source": source,
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
            row.detector, records, row.source, archive_science=True,
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
        try:
            put_science(job_id, index, raw_fits, raw_pixels)
        except ValueError:
            # A source exceeding the bounded science archive must not make
            # the ordinary astronomical PNG disappear.
            logger.warning("FITS source could not be archived: unsupported size or format")
        else:
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
            records, result, discovery = _discover(row, worker)
            initial = [{"index": i, "status": "pending"} for i in range(len(records))]
            _write(job_id, worker, records_data=records, result_data=result,
                   discovery_data=discovery, source=result["source"],
                   total_matches=result["total_matches"],
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

    # A matching *previously completed* sky search may be shown when both
    # remote catalog services are unavailable. Its real immutable assets
    # remain in the existing private bucket: no second IRSA fetch, no clone,
    # no new storage cost, and no disclosure of the original capability.
    source_id = (row.discovery_data or {}).get("_archive_source_job")
    if source_id:
        with _factory()() as db:
            previous = db.get(SkySearchJob, uuid.UUID(source_id))
            if (previous is None or previous.status not in ("complete", "partial")
                    or previous.demo or len(previous.frame_states or []) != len(records)):
                raise RuntimeError("Archived sky frames are no longer available")
            archived_states = [dict(item) for item in previous.frame_states]
        ready = sum(item["status"] == "ready" for item in archived_states)
        final = "complete" if ready == len(archived_states) else "partial" if ready else "failed"
        _write(job_id, worker, frame_states=archived_states, status=final)
        return

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
                   error_message=(str(exc) if isinstance(exc, TapFallbackError)
                                  else "No se pudo completar la búsqueda astronómica"))
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
