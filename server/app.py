"""Public SPHEREx cutout discovery and preview API.

Prototype/quicklook only: detector filtering is NOT equal to narrow wavelength matching.
Do not use its PNG displays for science-grade variability measurements.
"""
from __future__ import annotations

import base64
import io
import logging
import math
import secrets
import socket
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse
from urllib.error import HTTPError as UrlHTTPError, URLError as UrlURLError

import requests

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw
from reproject import reproject_interp
from requests.exceptions import ConnectionError as RequestsConnectionError, Timeout as RequestsTimeout
from sia2_compare import Sia2ComparisonError, query_sia2, compare_with_tap

logger = logging.getLogger("astrogram.irsa")

app = FastAPI(title="SPHEREx Social + Time Explorer", version="0.6.0")

# Social REST routes intentionally expose reads only until login/roles are implemented.
from social_api.api import router as social_router
from social_api.auth import router as auth_router
from social_api.posts import router as posts_router
from social_api.interactions import router as interactions_router
from social_api.observations import router as observations_router
from social_api.config import get_settings as get_social_settings
from fastapi.middleware.cors import CORSMiddleware
app.include_router(social_router)
app.include_router(auth_router)
app.include_router(posts_router)
app.include_router(interactions_router)
app.include_router(observations_router)
if get_social_settings().cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=get_social_settings().cors_origins,
                       allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])

SESSION_SECONDS = 3600
MAX_SESSIONS = 24
MAX_FRAMES = 16


@dataclass
class Session:
    ra: float
    dec: float
    size_arcmin: float
    detector: int
    records: list[dict]
    source: str
    created_at: float = field(default_factory=time.monotonic)
    frames: dict[int, dict] = field(default_factory=dict)
    catalog_records: list[dict] | None = None
    sia2_comparison: dict | None = None


_sessions: dict[str, Session] = {}
_lock = threading.RLock()

TAP_JOB_SECONDS = 1800
MAX_TAP_JOBS = 12
MAX_CONSECUTIVE_TAP_ERRORS = 8
RETRYABLE_TAP_HTTP_STATUSES = frozenset((429, 500, 502, 503, 504))
MAX_FITS_ATTEMPTS = 3
FITS_RETRY_DELAYS = (1.0, 2.0)
UWS_PHASES = frozenset(('PENDING', 'QUEUED', 'EXECUTING', 'COMPLETED', 'ERROR',
                        'ABORTED', 'HELD', 'SUSPENDED', 'UNKNOWN', 'ARCHIVED'))


@dataclass
class TapSearchJob:
    ra: float
    dec: float
    size_arcmin: float
    detector: int
    max_frames: int
    remote: Any
    created_at: float = field(default_factory=time.monotonic)
    result: dict | None = None
    consecutive_errors: int = 0
    retry_at: float = 0.0
    last_error_stage: str = ''
    submit_ms: int = 0
    run_ms: int = 0
    poll_count: int = 0
    poll_errors: int = 0
    phase_http_ms: int = 0
    result_fetch_ms: int | None = None
    result_parse_ms: int | None = None
    finished_at: float | None = None
    phase_events: list[dict] = field(default_factory=lambda: [{"phase": "QUEUED", "at_ms": 0}])
    phase_method: str = "unknown"
    phase_endpoint_unavailable: bool = False
    remote_start_time: str | None = None
    remote_end_time: str | None = None
    remote_execution_ms: int | None = None
    job_info_ms: int | None = None
    job_info_status: str = "not_requested"


_tap_jobs: dict[str, TapSearchJob] = {}


class SearchStart(BaseModel):
    ra: float = Field(default=133.795129, ge=0, lt=360, allow_inf_nan=False)
    dec: float = Field(default=-7.245147, ge=-90, le=90, allow_inf_nan=False)
    size_arcmin: float = Field(default=6, ge=1, le=12, allow_inf_nan=False)
    detector: int = Field(default=2, ge=1, le=6)
    max_frames: int = Field(default=12, ge=2, le=MAX_FRAMES)



def evenly_spaced(items: list, limit: int) -> list:
    """Select first, last and evenly-spaced observations in between."""
    if len(items) <= limit:
        return items
    indices = np.linspace(0, len(items) - 1, limit, dtype=int)
    return [items[int(i)] for i in indices]


def ensure_irsa_cutout_url(url: str) -> bool:
    """Never fetch an arbitrary user-provided URL or obsolete releases."""
    parsed = urlparse(url)
    return (
        parsed.scheme == "https"
        and parsed.hostname == "irsa.ipac.caltech.edu"
        and parsed.port is None
        and parsed.path.startswith(("/ibe/data/spherex/dr1/level2/", "/ibe/data/spherex/qr3/level2/"))
        and parsed.path.endswith(".fits")
        and "center=" in parsed.query
        and "size=" in parsed.query
    )


def make_irsa_query(ra: float, dec: float, size_arcmin: float, detector: int) -> str:
    """ADQL query based on IRSA SPHEREx Cutouts documentation."""
    size_deg = size_arcmin / 60
    bandpass = f"SPHEREx-D{detector}"
    return f"""
        SELECT
          'https://irsa.ipac.caltech.edu/' || a.uri ||
          '?center={ra},{dec}d&size={size_deg}' AS uri,
          p.time_bounds_lower
        FROM spherex.artifact a
        JOIN spherex.plane p ON a.planeid = p.planeid
        WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
          AND p.energy_bandpassname = '{bandpass}'
        ORDER BY p.time_bounds_lower
    """


def records_from_tap(table) -> list[dict]:
    result = []
    seen = set()
    for row in table:
        url = str(row["uri"])
        if not ensure_irsa_cutout_url(url) or url in seen:
            continue
        seen.add(url)
        mjd = float(row["time_bounds_lower"])
        if not math.isfinite(mjd):
            continue
        release = "DR1" if "/dr1/" in url else "QR3"
        result.append({"url": url, "mjd": mjd, "date": Time(mjd, format="mjd").isot, "release": release})
    return sorted(result, key=lambda record: record["mjd"])


def search_irsa(ra: float, dec: float, size_arcmin: float, detector: int) -> list[dict]:
    # Legacy synchronous endpoint, kept for backwards compatibility.
    return records_from_tap(Irsa.query_tap(make_irsa_query(ra, dec, size_arcmin, detector)))


def make_search_result(ra: float, dec: float, size_arcmin: float,
                       detector: int, max_frames: int, source: str,
                       all_records: list[dict]) -> dict:
    records = evenly_spaced(all_records, max_frames)
    session = Session(
        ra, dec, size_arcmin, detector, records, source,
        catalog_records=list(all_records) if source == "irsa" else None,
    )
    token = register_session(session)
    return {
        "search_id": token, "source": source, "total_matches": len(all_records),
        "count": len(records), "ra": ra, "dec": dec, "detector": detector,
        "observations": [
            {"index": i, "date": record["date"], "release": record["release"],
             "mjd": record["mjd"]}
            for i, record in enumerate(records)
        ],
    }


def demo_records() -> list[dict]:
    return [
        {"url": None, "mjd": 60810 + i * 35, "date": Time(60810 + i * 35, format="mjd").isot,
         "release": "SIMULATED"}
        for i in range(12)
    ]


def register_session(session: Session) -> str:
    token = secrets.token_urlsafe(18)
    with _lock:
        now = time.monotonic()
        for old in list(_sessions):
            if now - _sessions[old].created_at > SESSION_SECONDS:
                del _sessions[old]
        while len(_sessions) >= MAX_SESSIONS:
            del _sessions[min(_sessions, key=lambda k: _sessions[k].created_at)]
        _sessions[token] = session
    return token


def get_session(token: str) -> Session:
    with _lock:
        session = _sessions.get(token)
        if session and time.monotonic() - session.created_at <= SESSION_SECONDS:
            return session
    raise HTTPException(status_code=404, detail="Session expired. Search again.")


def make_target_wcs(ra: float, dec: float, size_arcmin: float) -> tuple[WCS, int]:
    # Approximate SPHEREx pixel scale: 6 arcsec/pixel. Output north-up, east-left.
    pixels = max(24, min(160, round(size_arcmin * 60 / 6)))
    wcs = WCS(naxis=2)
    wcs.wcs.crval = [ra, dec]
    wcs.wcs.crpix = [(pixels + 1) / 2, (pixels + 1) / 2]
    wcs.wcs.cdelt = [-6 / 3600, 6 / 3600]
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return wcs, pixels


def normalize_preview(arr: np.ndarray) -> np.ndarray:
    """Independent display stretch: suitable for motion inspection, not photometry."""
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return np.zeros(arr.shape, dtype=np.uint8)
    lo, hi = np.percentile(finite, [2, 99.5])
    if hi <= lo:
        hi = lo + 1
    values = np.clip((arr - lo) / (hi - lo), 0, 1)
    values = np.nan_to_num(values, nan=0, posinf=1, neginf=0)
    return np.uint8(np.arcsinh(8 * values) / np.arcsinh(8) * 255)


def png_data_url(image: np.ndarray) -> str:
    # FITS orientation has positive celestial Y upward; browser image Y downward.
    image = np.flipud(image)
    with io.BytesIO() as out:
        Image.fromarray(image, mode="L").save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def generate_demo(index: int, total: int) -> dict:
    img = Image.new("L", (128, 128), 7)
    draw = ImageDraw.Draw(img)
    rng = np.random.default_rng(616)
    for x, y, b in zip(rng.integers(2, 126, 45), rng.integers(2, 126, 45), rng.integers(65, 185, 45)):
        draw.ellipse((int(x)-1, int(y)-1, int(x)+1, int(y)+1), fill=int(b))
    x = 36 + int(index * 4)
    y = 58 + int(index * 0.8)
    draw.ellipse((x-3, y-3, x+3, y+3), fill=255)
    with io.BytesIO() as out:
        img.save(out, format="PNG")
        data_url = "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    return {"image": data_url, "wavelength_um": None, "bandwidth_um": None,
            "pixel_flags_nonzero_fraction": None, "mode": "simulated"}


def remote_http_status(exc: Exception) -> int | None:
    """Read status without including a FITS URL or remote error message."""
    value = getattr(exc, "code", None)
    if value is None:
        value = getattr(getattr(exc, "response", None), "status_code", None)
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def is_temporary_fits_error(exc: Exception, http_status: int | None) -> bool:
    """Retry only known transient HTTP statuses or transport interruptions."""
    if http_status is not None:
        return http_status in RETRYABLE_TAP_HTTP_STATUSES
    if isinstance(exc, (RequestsTimeout, RequestsConnectionError,
                        TimeoutError, ConnectionError, socket.timeout)):
        return True
    if isinstance(exc, UrlURLError):
        reason = exc.reason
        return isinstance(reason, (TimeoutError, ConnectionError, socket.timeout)) or (
            isinstance(reason, str) and ("timed out" in reason.lower()
                                        or "connection reset" in reason.lower()))
    return False


class FrameProcessingError(Exception):
    """Sanitized FITS failure, safe for client diagnostics and bounded retries."""

    def __init__(self, stage: str, original_type: str,
                 http_status: int | None = None, transient: bool = False):
        self.stage = stage
        self.original_type = original_type
        self.http_status = http_status
        self.transient = transient
        super().__init__(f"{stage}: {original_type}")


def render_real(session: Session, record: dict) -> dict:
    url = record["url"]
    if not ensure_irsa_cutout_url(url):
        raise FrameProcessingError("validacion_url", "ValueError")
    # FITS data may be loaded lazily; opening headers and reading pixels
    # are measured separately. Neither step reveals a server-side IRSA timer.
    started = time.monotonic()
    step = "apertura_fits"
    times: dict[str, int] = {}
    try:
        checkpoint = time.monotonic()
        with fits.open(url, memmap=False, cache=False) as hdus:
            times["apertura_fits"] = elapsed_ms(checkpoint)

            step = "lectura_pixeles"
            checkpoint = time.monotonic()
            src = np.asarray(hdus["IMAGE"].data, dtype=np.float32)
            header = hdus["IMAGE"].header
            times["lectura_pixeles"] = elapsed_ms(checkpoint)

            step = "reproyeccion"
            checkpoint = time.monotonic()
            spatial = WCS(header)
            target, pixels = make_target_wcs(session.ra, session.dec, session.size_arcmin)
            reproj, footprint = reproject_interp((src, spatial), target, shape_out=(pixels, pixels))
            reproj = np.where(footprint > 0, reproj, np.nan)
            times["reproyeccion"] = elapsed_ms(checkpoint)

            step = "metadatos"
            checkpoint = time.monotonic()
            coord = SkyCoord(session.ra * u.deg, session.dec * u.deg, frame="icrs")
            x, y = spatial.world_to_pixel(coord)
            wavelength_um = None
            bandwidth_um = None
            try:
                spectral = WCS(header=header, fobj=hdus, key="W")
                spectral.sip = None
                wl, bw = spectral.pixel_to_world(x, y)
                wavelength_um = float(wl.to_value(u.um))
                bandwidth_um = float(bw.to_value(u.um))
            except (KeyError, ValueError, TypeError):
                pass
            flags_fraction = None
            if "FLAGS" in hdus:
                flags = hdus["FLAGS"].data
                if flags is not None:
                    flags_fraction = float(np.count_nonzero(flags) / flags.size)
            times["metadatos"] = elapsed_ms(checkpoint)

            step = "png"
            checkpoint = time.monotonic()
            image = png_data_url(normalize_preview(reproj))
            times["png"] = elapsed_ms(checkpoint)
            times["total"] = elapsed_ms(started)
            return {
                "image": image,
                "wavelength_um": wavelength_um,
                "bandwidth_um": bandwidth_um,
                "pixel_flags_nonzero_fraction": flags_fraction,
                "mode": "real",
                "timing_ms": times,
            }
    except Exception as exc:
        status = remote_http_status(exc)
        raise FrameProcessingError(
            step, type(exc).__name__, status,
            step == "apertura_fits" and is_temporary_fits_error(exc, status),
        ) from exc


@app.get("/api/health")
def health():
    return {"status": "ok", "mission": "SPHEREx", "releases": ["DR1", "QR3"]}


@app.get("/api/search")
def search(
    ra: float = Query(133.795129, ge=0, lt=360),
    dec: float = Query(-7.245147, ge=-90, le=90),
    size_arcmin: float = Query(6.0, ge=1, le=12),
    detector: int = Query(2, ge=1, le=6),
    max_frames: int = Query(12, ge=2, le=MAX_FRAMES),
    demo: bool = False,
):
    try:
        all_records = demo_records() if demo else search_irsa(ra, dec, size_arcmin, detector)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IRSA query failed: {type(exc).__name__}") from exc
    return make_search_result(ra, dec, size_arcmin, detector, max_frames,
                              "simulated" if demo else "irsa", all_records)



def get_tap_job(ticket: str) -> TapSearchJob:
    with _lock:
        job = _tap_jobs.get(ticket)
    if job is None or time.monotonic() - job.created_at > TAP_JOB_SECONDS:
        raise HTTPException(status_code=404, detail="Search job not found or expired")
    return job


def elapsed_ms(start: float) -> int:
    return max(0, round((time.monotonic() - start) * 1000))


def tap_timing(job: TapSearchJob) -> dict:
    """Durations are intervals between *observed* TAP phases, not IRSA CPU time."""
    with _lock:
        now = job.finished_at or time.monotonic()
        active_ms = max(0, round((now - job.created_at) * 1000))
        events = [dict(item) for item in job.phase_events]
        periods: dict[str, int] = {}
        for i, event in enumerate(events):
            end_ms = events[i + 1]["at_ms"] if i + 1 < len(events) else active_ms
            phase = event["phase"]
            periods[phase] = periods.get(phase, 0) + max(0, end_ms - event["at_ms"])
        return {
            "submit_ms": job.submit_ms, "run_ms": job.run_ms,
            "remote_observed_ms": active_ms,
            "phase_observed_ms": periods,
            "phase_events": events,
            "poll_count": job.poll_count, "poll_errors": job.poll_errors,
            "phase_http_ms": job.phase_http_ms,
            "result_fetch_ms": job.result_fetch_ms,
            "result_parse_ms": job.result_parse_ms,
            "phase_method": job.phase_method,
            "remote_start_time": job.remote_start_time,
            "remote_end_time": job.remote_end_time,
            "remote_execution_ms": job.remote_execution_ms,
            "job_info_ms": job.job_info_ms,
            "job_info_status": job.job_info_status,
        }


def observe_tap_phase(job: TapSearchJob, phase: str) -> None:
    with _lock:
        if job.phase_events[-1]["phase"] != phase:
            at_ms = elapsed_ms(job.created_at)
            job.phase_events.append({"phase": phase, "at_ms": at_ms})
            logger.info("TAP phase transition: %s at %sms", phase, at_ms)


def validate_uws_job_url(remote: Any) -> str | None:
    """Use only PyVO's known IRSA TAP job URL, never an arbitrary remote host."""
    raw = getattr(remote, "url", None)
    if not raw:
        return None  # Enables test doubles / legacy PyVO compatibility.
    parsed = urlparse(raw)
    if (parsed.scheme != "https" or parsed.hostname != "irsa.ipac.caltech.edu"
            or parsed.port is not None or parsed.username is not None
            or not parsed.path.startswith("/TAP/async/")
            or parsed.query or parsed.fragment):
        raise ValueError("Unexpected IRSA TAP job URL")
    return raw.rstrip("/")


def job_http_get(remote: Any, url: str):
    """Reuse PyVO's HTTP session (cookies/config) when available."""
    session = getattr(remote, "_session", None)
    client = session if session is not None else requests
    return client.get(url, timeout=(5, 15), allow_redirects=False)


def read_tap_phase(job: TapSearchJob) -> str:
    """Poll the small UWS /phase resource; fall back on unsupported servers."""
    remote = job.remote
    url = validate_uws_job_url(remote)
    if url and not job.phase_endpoint_unavailable:
        response = job_http_get(remote, f"{url}/phase")
        if response.status_code == 200:
            value = response.text.strip().upper()
            if value in UWS_PHASES:
                job.phase_method = "phase_endpoint"
                return value
            # Some services respond with an XML job instead of plain text.
            job.phase_endpoint_unavailable = True
        elif response.status_code in (303, 404, 405, 406, 501):
            job.phase_endpoint_unavailable = True
        else:
            response.raise_for_status()
            raise ValueError("Unexpected IRSA /phase response")
    job.phase_method = "full_job_fallback"
    return str(remote.phase).strip().upper()


def read_tap_remote_times(job: TapSearchJob) -> None:
    """Best-effort single UWS job XML fetch; not a prerequisite for results."""
    if job.job_info_status != "not_requested":
        return
    job.job_info_status = "unavailable"
    start = time.monotonic()
    try:
        url = validate_uws_job_url(job.remote)
        if not url:
            job.job_info_status = "no_url"
            return
        response = job_http_get(job.remote, url)
        response.raise_for_status()
        content = response.content
        if len(content) > 262144:
            raise ValueError("UWS job document too large")
        root = ET.fromstring(content)
        found = {}
        for node in root.iter():
            tag = node.tag.rsplit("}", 1)[-1]
            if tag in ("startTime", "endTime") and node.text and node.text.strip():
                found[tag] = node.text.strip()
        job.remote_start_time = found.get("startTime")
        job.remote_end_time = found.get("endTime")
        job.job_info_status = "available" if found else "missing_timestamps"
        if job.remote_start_time and job.remote_end_time:
            a = datetime.fromisoformat(job.remote_start_time.replace("Z", "+00:00"))
            b = datetime.fromisoformat(job.remote_end_time.replace("Z", "+00:00"))
            if a.tzinfo and b.tzinfo:
                job.remote_execution_ms = max(0, round((b - a).total_seconds() * 1000))
    except Exception as exc:
        job.job_info_status = f"unavailable:{type(exc).__name__}"
        logger.warning("UWS job timing metadata unavailable (%s)", type(exc).__name__)
    finally:
        job.job_info_ms = elapsed_ms(start)


def is_temporary_tap_error(exc: Exception) -> bool:
    """Retry transport failures and HTTP 429/5xx, not invalid queries/jobs."""
    cause = getattr(exc, "cause", None)
    if isinstance(exc, (RequestsConnectionError, RequestsTimeout)) or isinstance(
        cause, (RequestsConnectionError, RequestsTimeout)
    ):
        return True
    code = getattr(exc, "code", None)
    if code is None:
        response = getattr(exc, "response", None)
        if response is None:
            response = getattr(cause, "response", None)
        code = getattr(response, "status_code", None)
    try:
        return int(code) in RETRYABLE_TAP_HTTP_STATUSES
    except (TypeError, ValueError):
        return False


def tap_retry_response(job: TapSearchJob, exc: Exception, stage: str):
    """Keep remote TAP job alive when IRSA's proxy temporarily rejects a poll."""
    if not is_temporary_tap_error(exc):
        logger.exception("IRSA TAP %s failed permanently", stage)
        raise HTTPException(
            status_code=502, detail=f"IRSA TAP {stage} failed: {type(exc).__name__}"
        ) from exc

    with _lock:
        job.consecutive_errors += 1
        attempts = job.consecutive_errors
        job.last_error_stage = stage
        delay = min(30, 3 * (2 ** min(attempts - 1, 4)))
        job.retry_at = time.monotonic() + delay

    if attempts > MAX_CONSECUTIVE_TAP_ERRORS:
        logger.error("IRSA TAP %s unavailable after %s consecutive transient failures",
                     stage, attempts)
        raise HTTPException(
            status_code=503,
            detail=f"IRSA sigue rechazando consultas de {stage} tras {attempts} intentos. "
                   "Intenta una nueva búsqueda más tarde.",
        ) from exc

    logger.warning("IRSA TAP %s temporarily unavailable (%s), retry %s in %ss",
                   stage, type(exc).__name__, attempts, delay)
    return JSONResponse({
        "phase": "RETRYING",
        "warning": f"IRSA no respondió al consultar {stage}. "
                   "Conservamos el trabajo e intentaremos de nuevo.",
        "retry_after_seconds": delay,
        "attempt": attempts,
        "timing": tap_timing(job),
    }, headers={"Cache-Control": "no-store"})


def tap_wait_response(job: TapSearchJob):
    with _lock:
        seconds = max(0, job.retry_at - time.monotonic())
        count = job.consecutive_errors
        stage = job.last_error_stage
    return JSONResponse({
        "phase": "RETRYING",
        "warning": f"Esperando antes de reintentar {stage}.",
        "retry_after_seconds": max(1, math.ceil(seconds)),
        "attempt": count,
        "timing": tap_timing(job),
    }, headers={"Cache-Control": "no-store"})


def clear_tap_errors(job: TapSearchJob):
    with _lock:
        job.consecutive_errors = 0
        job.retry_at = 0.0
        job.last_error_stage = ""


@app.post("/api/search/jobs", status_code=202)
def start_search_job(params: SearchStart):
    """Submit IRSA TAP /async, not the five-minute synchronous endpoint."""
    with _lock:
        # Do not perform network calls while holding the shared lock.
        for key in list(_tap_jobs):
            if time.monotonic() - _tap_jobs[key].created_at > TAP_JOB_SECONDS:
                del _tap_jobs[key]
        if len(_tap_jobs) >= MAX_TAP_JOBS:
            raise HTTPException(status_code=429, detail="Too many active searches; try again later")
    query = make_irsa_query(params.ra, params.dec, params.size_arcmin, params.detector)
    submitted_at = time.monotonic()
    try:
        remote = Irsa.tap.submit_job(query, maxrec=5000)
    except Exception as exc:
        # POST /TAP/async is not idempotent. A proxy 502 does not prove
        # the remote job was never created, so never retry it blindly.
        logger.warning("IRSA TAP async job creation failed", exc_info=True)
        if is_temporary_tap_error(exc):
            raise HTTPException(
                status_code=503,
                detail="IRSA no está aceptando la creación de trabajos TAP en este momento. "
                       "No se reintentó automáticamente para evitar trabajos duplicados. "
                       "Vuelve a intentarlo manualmente más tarde.",
                headers={"Retry-After": "30", "Cache-Control": "no-store"},
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=f"IRSA rechazó la creación del trabajo TAP: {type(exc).__name__}",
        ) from exc

    submit_ms = elapsed_ms(submitted_at)
    ran_at = time.monotonic()
    try:
        remote.run()
    except Exception as exc:
        logger.warning("IRSA TAP job execution start failed", exc_info=True)
        # The job ID is known, even though starting it was unsuccessful.
        # Best-effort cleanup prevents leaving remote jobs without a ticket.
        try:
            remote.delete()
        except Exception:
            logger.warning("IRSA TAP job cleanup failed after RUN error", exc_info=True)
        if is_temporary_tap_error(exc):
            raise HTTPException(
                status_code=503,
                detail="IRSA creó el trabajo pero no confirmó su ejecución. "
                       "Se intentó limpiar el trabajo remoto. "
                       "Vuelve a intentarlo manualmente más tarde.",
                headers={"Retry-After": "30", "Cache-Control": "no-store"},
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=f"IRSA no pudo iniciar el trabajo TAP: {type(exc).__name__}",
        ) from exc

    run_ms = elapsed_ms(ran_at)
    ticket = secrets.token_urlsafe(24)
    job = TapSearchJob(params.ra, params.dec, params.size_arcmin,
                       params.detector, params.max_frames, remote,
                       submit_ms=submit_ms, run_ms=run_ms)
    with _lock:
        _tap_jobs[ticket] = job
    logger.info("TAP job submitted: submit=%sms run=%sms", submit_ms, run_ms)
    return JSONResponse(
        {"job_id": ticket, "phase": "QUEUED", "timing": tap_timing(job)},
        status_code=202, headers={"Cache-Control": "no-store"})


@app.get("/api/search/jobs/{ticket}")
def poll_search_job(ticket: str):
    """One short remote phase check per call; no long-held browser connection."""
    job = get_tap_job(ticket)
    with _lock:
        if job.result is not None:
            return {"phase": "COMPLETED", "result": job.result, "timing": tap_timing(job)}
        waiting = job.retry_at > time.monotonic()
    if waiting:
        return tap_wait_response(job)

    requested_at = time.monotonic()
    try:
        phase = read_tap_phase(job)
    except Exception as exc:
        with _lock:
            job.poll_count += 1
            job.poll_errors += 1
            job.phase_http_ms += elapsed_ms(requested_at)
        return tap_retry_response(job, exc, "estado del trabajo")
    with _lock:
        job.poll_count += 1
        job.phase_http_ms += elapsed_ms(requested_at)
    observe_tap_phase(job, phase)
    # Preserve the consecutive-error counter while the remote job is
    # complete but the result payload itself is repeatedly failing.
    if phase != "COMPLETED" or job.last_error_stage != "descarga del catálogo":
        clear_tap_errors(job)
    if phase in ("PENDING", "QUEUED", "EXECUTING", "HELD", "SUSPENDED", "UNKNOWN"):
        return JSONResponse({"phase": phase, "timing": tap_timing(job)},
                            headers={"Cache-Control": "no-store"})
    if phase in ("ERROR", "ABORTED"):
        return JSONResponse({"phase": phase, "error": "IRSA could not complete the catalog query",
                             "timing": tap_timing(job)},
                            headers={"Cache-Control": "no-store"})
    if phase != "COMPLETED":
        return JSONResponse({"phase": phase, "timing": tap_timing(job)},
                            headers={"Cache-Control": "no-store"})
    try:
        fetch_started = time.monotonic()
        table = job.remote.fetch_result()
        with _lock:
            job.result_fetch_ms = elapsed_ms(fetch_started)
        parse_started = time.monotonic()
        records = records_from_tap(table)
        result = make_search_result(job.ra, job.dec, job.size_arcmin,
                                    job.detector, job.max_frames, "irsa", records)
        with _lock:
            job.result_parse_ms = elapsed_ms(parse_started)
    except Exception as exc:
        return tap_retry_response(job, exc, "descarga del catálogo")
    clear_tap_errors(job)
    read_tap_remote_times(job)
    with _lock:
        if job.result is None:
            job.result = result
            job.finished_at = time.monotonic()
        logger.info("TAP catalog completed: timing=%s", tap_timing(job))
        return {"phase": "COMPLETED", "result": job.result,
                "timing": tap_timing(job)}


@app.delete("/api/search/jobs/{ticket}", status_code=204)
def cancel_search_job(ticket: str):
    job = get_tap_job(ticket)
    with _lock:
        _tap_jobs.pop(ticket, None)
    try:
        job.remote.abort()
    except Exception:
        pass
    try:
        job.remote.delete()
    except Exception:
        pass
    return None

@app.post("/api/search/sia2")
def search_sia2_primary(params: SearchStart):
    """Explore SPHEREx using the fast SIA2 metadata API, without any TAP job.

    Only complete, correctly typed responses may drive the preview session.
    A non-OK/overflow SIA2 response fails cleanly so the frontend can offer
    the existing async TAP fallback. No silent scientific truncation.
    """
    try:
        sia = query_sia2(params.ra, params.dec, params.size_arcmin, params.detector)
    except Sia2ComparisonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (RequestsTimeout, RequestsConnectionError) as exc:
        raise HTTPException(status_code=504,
                            detail=f"IRSA SIA2 no respondió: {type(exc).__name__}") from exc

    if not sia["complete"]:
        raise HTTPException(
            status_code=503,
            detail=f"Resultado SIA2 incompleto ({sia['query_status']}); utiliza TAP como respaldo",
        )

    records = []
    for row in sia["records"]:
        mjd = row.get("mjd")
        if mjd is None or not math.isfinite(mjd) or row.get("date") is None:
            continue
        url = ("https://irsa.ipac.caltech.edu" + row["path"]
               + f"?center={params.ra},{params.dec}d&size={params.size_arcmin / 60}")
        if not ensure_irsa_cutout_url(url):
            continue
        records.append({
            "url": url, "mjd": mjd,
            "date": row["date"], "release": row["release"],
        })

    # If SIA reports matching products but all are unusable, this is not an
    # empty sky field. Avoid falsely promising there are no observations.
    if sia["matching_detector_rows"] > 0 and not records:
        raise HTTPException(
            status_code=502,
            detail="SIA2 devolvió productos para el detector, pero ninguno permite crear épocas válidas",
        )

    records.sort(key=lambda record: record["mjd"])
    result = make_search_result(
        params.ra, params.dec, params.size_arcmin, params.detector,
        params.max_frames, "sia2", records,
    )
    result["discovery"] = {
        "method": "sia2",
        "elapsed_ms": sia["elapsed_ms"],
        "http_ms": sia["http_ms"],
        "parse_ms": sia["parse_ms"],
        "attempts": sia["attempts"],
        "retry_events": sia["retry_events"],
        "query_status": sia["query_status"],
        "matching_detector_rows": sia["matching_detector_rows"],
        "valid_cutout_rows": sia["valid_cutout_rows"],
        "usable_epoch_rows": len(records),
        "radius_arcsec": sia["radius_arcsec"],
    }
    return JSONResponse(result, headers={"Cache-Control": "private, no-store"})


@app.get("/api/diagnostics/sia2/{search_id}")
def compare_sia2_with_existing_tap(search_id: str):
    """Read-only SIA2 benchmark using a completed TAP catalog already in RAM.

    Does not submit a second TAP job and never downloads a FITS. Neither
    comparison nor its cached result becomes the primary explorer search.
    """
    session = get_session(search_id)
    if session.source != "irsa" or session.catalog_records is None:
        raise HTTPException(
            status_code=422, detail="La comparación requiere un catálogo TAP real completado"
        )
    with _lock:
        cached = session.sia2_comparison
    if cached is not None:
        return JSONResponse(cached, headers={"Cache-Control": "private, no-store"})

    try:
        sia2 = query_sia2(session.ra, session.dec, session.size_arcmin, session.detector)
        result = compare_with_tap(sia2, session.catalog_records, session.records)
    except Sia2ComparisonError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (RequestsTimeout, RequestsConnectionError) as exc:
        raise HTTPException(status_code=504,
                            detail=f"IRSA SIA2 no respondió: {type(exc).__name__}") from exc
    except Exception as exc:
        logger.warning("SIA2 comparison failed: %s", type(exc).__name__, exc_info=True)
        raise HTTPException(status_code=502,
                            detail=f"La comparación SIA2 falló: {type(exc).__name__}") from exc

    result["query"] = {
        "ra": session.ra, "dec": session.dec,
        "size_arcmin": session.size_arcmin, "detector": session.detector,
    }
    with _lock:
        if session.sia2_comparison is None:
            session.sia2_comparison = result
        result = session.sia2_comparison
    return JSONResponse(result, headers={"Cache-Control": "private, no-store"})


@app.get("/api/frame/{search_id}/{index}")
def frame(search_id: str, index: int):
    session = get_session(search_id)
    if index < 0 or index >= len(session.records):
        raise HTTPException(status_code=404, detail="Frame not found")
    with _lock:
        if index in session.frames:
            return session.frames[index]
    # GET FITS cutouts are idempotent. Retry only known transient errors
    # at the remote-open stage; never retry 404/403 or local WCS/PNG failures.
    max_attempts = MAX_FITS_ATTEMPTS if session.source == "irsa" else 1
    started_at = time.monotonic()
    rendered: dict = {}
    attempts = 0
    for attempt in range(1, max_attempts + 1):
        attempts = attempt
        try:
            rendered = (generate_demo(index, len(session.records)) if session.source == "simulated"
                        else render_real(session, session.records[index]))
            break
        except FrameProcessingError as exc:
            logger.warning(
                "FITS frame index=%s attempt=%s stage=%s type=%s remote_http=%s transient=%s",
                index, attempt, exc.stage, exc.original_type, exc.http_status, exc.transient,
            )
            if exc.transient and attempt < max_attempts:
                time.sleep(FITS_RETRY_DELAYS[attempt - 1])
                continue
            suffix = f" HTTP {exc.http_status}" if exc.http_status is not None else ""
            raise HTTPException(
                status_code=502,
                detail=f"FITS falló en {exc.stage}: {exc.original_type}{suffix}"
                       f" ({attempt} intento{'s' if attempt != 1 else ''})",
            ) from exc
        except Exception as exc:
            logger.warning("FITS frame error index=%s stage=desconocida type=%s",
                           index, type(exc).__name__)
            raise HTTPException(status_code=502, detail=f"FITS falló: {type(exc).__name__}") from exc
    if "timing_ms" in rendered:
        rendered["timing_ms"] = {
            **rendered["timing_ms"], "attempts": attempts,
            "total_with_retries": elapsed_ms(started_at),
        }
    result = {**rendered, "index": index, "date": session.records[index]["date"],
              "release": session.records[index]["release"]}
    with _lock:
        session.frames[index] = result
    return JSONResponse(result, headers={"Cache-Control": "private, max-age=600"})


# Durable sky searches: PostgreSQL metadata + private S3 PNGs. Keep the
# short-lived legacy /api/search session endpoints for existing consumers.
from persistent_sky import router as persistent_sky_router, start_dispatcher  # noqa: E402
app.include_router(persistent_sky_router)
app.add_event_handler("startup", start_dispatcher)
