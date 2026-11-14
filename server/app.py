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
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

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


_sessions: dict[str, Session] = {}
_lock = threading.RLock()

TAP_JOB_SECONDS = 1800
MAX_TAP_JOBS = 12


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
    session = Session(ra, dec, size_arcmin, detector, records, source)
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


def render_real(session: Session, record: dict) -> dict:
    url = record["url"]
    if not ensure_irsa_cutout_url(url):
        raise ValueError("Unexpected remote data URL")
    # Official IRSA endpoint performs the cutout on its server before download.
    with fits.open(url, memmap=False, cache=False) as hdus:
        src = np.asarray(hdus["IMAGE"].data, dtype=np.float32)
        header = hdus["IMAGE"].header
        spatial = WCS(header)
        target, pixels = make_target_wcs(session.ra, session.dec, session.size_arcmin)
        reproj, footprint = reproject_interp((src, spatial), target, shape_out=(pixels, pixels))
        reproj = np.where(footprint > 0, reproj, np.nan)
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
        return {"image": png_data_url(normalize_preview(reproj)),
                "wavelength_um": wavelength_um, "bandwidth_um": bandwidth_um,
                "pixel_flags_nonzero_fraction": flags_fraction, "mode": "real"}


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
    try:
        remote = Irsa.tap.submit_job(query, maxrec=5000)
        remote.run()
    except Exception as exc:
        logger.exception("IRSA TAP async submit/run failed")
        raise HTTPException(status_code=502, detail=f"IRSA TAP job submission failed: {type(exc).__name__}") from exc
    ticket = secrets.token_urlsafe(24)
    with _lock:
        _tap_jobs[ticket] = TapSearchJob(params.ra, params.dec, params.size_arcmin,
                                        params.detector, params.max_frames, remote)
    return JSONResponse({"job_id": ticket, "phase": "QUEUED"}, status_code=202,
                        headers={"Cache-Control": "no-store"})


@app.get("/api/search/jobs/{ticket}")
def poll_search_job(ticket: str):
    """One short remote phase check per call; no long-held browser connection."""
    job = get_tap_job(ticket)
    with _lock:
        if job.result is not None:
            return {"phase": "COMPLETED", "result": job.result}
    try:
        phase = str(job.remote.phase).upper()
    except Exception as exc:
        logger.exception("IRSA TAP async phase check failed")
        raise HTTPException(status_code=502, detail=f"IRSA TAP phase check failed: {type(exc).__name__}") from exc
    if phase in ("PENDING", "QUEUED", "EXECUTING", "HELD", "SUSPENDED", "UNKNOWN"):
        return JSONResponse({"phase": phase}, headers={"Cache-Control": "no-store"})
    if phase in ("ERROR", "ABORTED"):
        return JSONResponse({"phase": phase, "error": "IRSA could not complete the catalog query"},
                            headers={"Cache-Control": "no-store"})
    if phase != "COMPLETED":
        return JSONResponse({"phase": phase}, headers={"Cache-Control": "no-store"})
    try:
        records = records_from_tap(job.remote.fetch_result())
        result = make_search_result(job.ra, job.dec, job.size_arcmin,
                                    job.detector, job.max_frames, "irsa", records)
    except Exception as exc:
        logger.exception("IRSA TAP async result retrieval failed")
        raise HTTPException(status_code=502, detail=f"IRSA TAP result retrieval failed: {type(exc).__name__}") from exc
    with _lock:
        if job.result is None:
            job.result = result
        return {"phase": "COMPLETED", "result": job.result}


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

@app.get("/api/frame/{search_id}/{index}")
def frame(search_id: str, index: int):
    session = get_session(search_id)
    if index < 0 or index >= len(session.records):
        raise HTTPException(status_code=404, detail="Frame not found")
    with _lock:
        if index in session.frames:
            return session.frames[index]
    try:
        rendered = (generate_demo(index, len(session.records)) if session.source == "simulated"
                    else render_real(session, session.records[index]))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FITS cutout failed: {type(exc).__name__}") from exc
    result = {**rendered, "index": index, "date": session.records[index]["date"],
              "release": session.records[index]["release"]}
    with _lock:
        session.frames[index] = result
    return JSONResponse(result, headers={"Cache-Control": "private, max-age=600"})
