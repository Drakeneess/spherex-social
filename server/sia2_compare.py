"""Read-only SIA2 benchmark against an already completed SPHEREx TAP search.

This module does not start TAP jobs or download FITS products. The SIA query
covers a 1-arcsecond circle around the exact TAP point; minor edge differences
are expected. Never assume SIA and TAP ingestion schedules are identical.
"""
from __future__ import annotations

from collections import Counter
from io import BytesIO
import math
import time
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import requests
from astropy.io.votable import parse_single_table
from astropy.time import Time

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
COLLECTIONS = (
    "spherex_dr1", "spherex_dr1_deep",
    "spherex_qr3", "spherex_qr3_deep",
)
RADIUS_ARCSEC = 1.0
SIA_MAXREC = 5000
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
SIA_CONNECT_TIMEOUT_SECONDS = 12
SIA_READ_TIMEOUT_SECONDS = 40
SIA_RETRY_DELAYS = (1.0, 3.0)
SIA_TRANSIENT_HTTP = frozenset((429, 500, 502, 503, 504))


class Sia2ComparisonError(Exception):
    pass


def _elapsed_ms(t0: float) -> int:
    return max(0, round((time.monotonic() - t0) * 1000))


def fits_path(url: str) -> str | None:
    """Only accepted on-premises SPHEREx spectral-image FITS paths."""
    if not isinstance(url, str):
        return None
    parsed = urlparse(url.strip())
    if (parsed.scheme != "https" or parsed.hostname != "irsa.ipac.caltech.edu"
            or parsed.port is not None or parsed.username is not None
            or parsed.password is not None or parsed.fragment):
        return None
    if not parsed.path.endswith(".fits"):
        return None
    if not parsed.path.startswith((
        "/ibe/data/spherex/dr1/level2/",
        "/ibe/data/spherex/qr3/level2/",
    )):
        return None
    return parsed.path


def cutout_compatible(base_url: str, ra: float, dec: float, size_arcmin: float) -> bool:
    """Validate cutout URL *shape*, not whether the remote FITS is reachable."""
    path = fits_path(base_url)
    if path is None:
        return False
    parsed = urlparse(base_url)
    if parsed.query:  # SIA access_url should be a base FITS image URL.
        return False
    cutout_url = f"{base_url}?center={ra},{dec}d&size={size_arcmin / 60}"
    return fits_path(cutout_url) == path and (
        "center=" in urlparse(cutout_url).query
        and "size=" in urlparse(cutout_url).query
    )


def _plain(value) -> str:
    if value is None or getattr(value, "mask", False) is True:
        return ""
    string = str(value).strip()
    return "" if string in ("--", "nan", "None", "masked") else string


def _date_from_mjd(value) -> str | None:
    try:
        mjd = float(value)
        if math.isfinite(mjd):
            return Time(mjd, format="mjd").isot
    except (TypeError, ValueError):
        pass
    return None


def _range(records: list[dict]) -> dict:
    dates = sorted(x["date"] for x in records if x.get("date"))
    return {"earliest": dates[0] if dates else None,
            "latest": dates[-1] if dates else None}


def _samples(records: list[dict], paths: set[str], limit: int = 5) -> list[dict]:
    return [
        {"date": item.get("date"), "release": item.get("release")}
        for item in records if item["path"] in paths
    ][:limit]


def query_sia2(ra: float, dec: float, size_arcmin: float, detector: int) -> dict:
    """Retrieve and validate one bounded SIA2 VOTable; no TAP side effects."""
    params = [
        ("POS", f"CIRCLE {ra} {dec} {RADIUS_ARCSEC / 3600}"),
        ("MAXREC", str(SIA_MAXREC)),
        ("RESPONSEFORMAT", "VOTABLE"),
        *[("COLLECTION", name) for name in COLLECTIONS],
    ]
    t0 = time.monotonic()
    attempt_details: list[dict] = []
    response = None
    http_ms = 0
    # This is a read-only GET. Retry only transient transport failures and
    # temporary upstream statuses, never a QUERY_STATUS=ERROR VOTable.
    for attempt in range(1, len(SIA_RETRY_DELAYS) + 2):
        requested_at = time.monotonic()
        try:
            response = requests.get(
                SIA_URL, params=params,
                timeout=(SIA_CONNECT_TIMEOUT_SECONDS, SIA_READ_TIMEOUT_SECONDS),
                allow_redirects=False,
            )
        except requests.exceptions.SSLError as exc:
            raise Sia2ComparisonError("SIA2 no pudo validar la conexión TLS (SSLError)") from exc
        except (requests.exceptions.ConnectTimeout,
                requests.exceptions.ReadTimeout,
                requests.exceptions.ConnectionError) as exc:
            elapsed = _elapsed_ms(requested_at)
            http_ms += elapsed
            attempt_details.append({
                "attempt": attempt, "elapsed_ms": elapsed,
                "failure": type(exc).__name__,
            })
            if attempt > len(SIA_RETRY_DELAYS):
                raise Sia2ComparisonError(
                    f"IRSA SIA2 no respondió tras {attempt} intentos "
                    f"({type(exc).__name__}, {_elapsed_ms(t0) / 1000:.1f} s)"
                ) from exc
            time.sleep(SIA_RETRY_DELAYS[attempt - 1])
            continue

        elapsed = _elapsed_ms(requested_at)
        http_ms += elapsed
        if response.status_code == 200:
            break
        if response.status_code not in SIA_TRANSIENT_HTTP:
            raise Sia2ComparisonError(f"SIA2 devolvió HTTP {response.status_code}")
        attempt_details.append({
            "attempt": attempt, "elapsed_ms": elapsed,
            "failure": f"HTTP {response.status_code}",
        })
        if attempt > len(SIA_RETRY_DELAYS):
            raise Sia2ComparisonError(
                f"IRSA SIA2 devolvió HTTP {response.status_code} tras {attempt} intentos"
            )
        time.sleep(SIA_RETRY_DELAYS[attempt - 1])
    if response is None:
        raise Sia2ComparisonError("SIA2 no devolvió ninguna respuesta")
    raw = response.content
    if len(raw) > MAX_RESPONSE_BYTES:
        raise Sia2ComparisonError("La respuesta SIA2 supera el límite de diagnóstico")
    parse_started = time.monotonic()
    try:
        root = ET.fromstring(raw)
        status = [
            (node.get("value") or "").upper()
            for node in root.iter()
            if node.tag.rsplit("}", 1)[-1] == "INFO"
            and (node.get("name") or "").upper() == "QUERY_STATUS"
        ]
        query_status = status[-1] if status else "UNKNOWN"
        if query_status == "ERROR":
            raise Sia2ComparisonError("SIA2 devolvió QUERY_STATUS=ERROR")
        table = parse_single_table(BytesIO(raw)).to_table(use_names_over_ids=True)
    except Sia2ComparisonError:
        raise
    except Exception as exc:
        raise Sia2ComparisonError(f"Respuesta VOTable inválida: {type(exc).__name__}") from exc
    parse_ms = _elapsed_ms(parse_started)

    required = {"access_url", "energy_bandpassname", "t_min"}
    if not required.issubset(set(table.colnames)):
        raise Sia2ComparisonError("SIA2 no incluyó access_url, energy_bandpassname y t_min")

    matching_detector = 0
    valid_cutouts = 0
    seen: set[str] = set()
    records: list[dict] = []
    discarded = Counter()
    for row in table:
        bandpass = _plain(row["energy_bandpassname"])
        if bandpass != f"SPHEREx-D{detector}":
            continue
        matching_detector += 1
        access_url = _plain(row["access_url"])
        path = fits_path(access_url)
        if not path or not cutout_compatible(access_url, ra, dec, size_arcmin):
            discarded["invalid_or_nonlocal_cutout"] += 1
            continue
        valid_cutouts += 1
        if path in seen:
            discarded["duplicate_fits_path"] += 1
            continue
        seen.add(path)
        mjd_raw = _plain(row["t_min"])
        date = _date_from_mjd(mjd_raw)
        mjd = float(mjd_raw) if date is not None else None
        release = "DR1" if "/dr1/" in path else "QR3"
        records.append({"path": path, "date": date, "mjd": mjd, "release": release})
    records.sort(key=lambda item: (item["date"] is None, item["date"] or ""))
    return {
        "elapsed_ms": _elapsed_ms(t0),
        "http_ms": http_ms,
        "parse_ms": parse_ms,
        "attempts": len(attempt_details) + 1,
        "retry_events": attempt_details,
        "query_status": query_status,
        "complete": query_status == "OK",
        "raw_rows": len(table),
        "matching_detector_rows": matching_detector,
        "valid_cutout_rows": valid_cutouts,
        "discarded": dict(discarded),
        "records": records,
        "collections": list(COLLECTIONS),
        "radius_arcsec": RADIUS_ARCSEC,
    }


def compare_with_tap(sia: dict, tap_records: list[dict],
                     selected_records: list[dict]) -> dict:
    """Match stable FITS file paths, never just similar observation dates."""
    tap = []
    seen = set()
    for rec in tap_records:
        path = fits_path(rec.get("url", ""))
        if path is None or path in seen:
            continue
        seen.add(path)
        tap.append({"path": path, "date": rec.get("date"),
                    "release": rec.get("release")})
    sia_records = sia["records"]
    tap_paths = {record["path"] for record in tap}
    sia_paths = {record["path"] for record in sia_records}
    selected_paths = {
        fits_path(rec.get("url", ""))
        for rec in selected_records
    } - {None}
    common = tap_paths & sia_paths
    tap_only = tap_paths - sia_paths
    sia_only = sia_paths - tap_paths
    valid = bool(sia["complete"])
    reasons = [
        "TAP usa CONTAINS(POINT), SIA2 usa un círculo de 1 segundo de arco.",
        "SIA2 puede incorporar observaciones más tarde que TAP.",
        "Compatible significa formato de URL; no se descargaron FITS para comprobar disponibilidad.",
    ]
    if not valid:
        reasons.append("SIA2 devolvió OVERFLOW o estado desconocido: sus recuentos son incompletos.")
    return {
        "source": "sia2_vs_tap",
        "sia2": {
            "elapsed_ms": sia["elapsed_ms"],
            "http_ms": sia["http_ms"], "parse_ms": sia["parse_ms"],
            "attempts": sia["attempts"], "retry_events": sia["retry_events"],
            "query_status": sia["query_status"],
            "complete": sia["complete"],
            "raw_rows": sia["raw_rows"],
            "matching_detector_rows": sia["matching_detector_rows"],
            "valid_cutout_rows": sia["valid_cutout_rows"],
            "unique_compatible_images": len(sia_paths),
            "releases": dict(Counter(r["release"] for r in sia_records)),
            "date_range": _range(sia_records),
            "discarded": sia["discarded"],
            "collections": sia["collections"],
            "radius_arcsec": sia["radius_arcsec"],
        },
        "tap": {
            "unique_images": len(tap_paths),
            "selected_epochs": len(selected_paths),
            "releases": dict(Counter(r["release"] for r in tap)),
            "date_range": _range(tap),
        },
        "overlap": {
            "matched": len(common),
            "tap_only": len(tap_only),
            "sia2_only": len(sia_only),
            "selected_tap_matched": len(selected_paths & sia_paths),
            "tap_only_examples": _samples(tap, tap_only),
            "sia2_only_examples": _samples(sia_records, sia_only),
        },
        "comparable": valid,
        "caveats": reasons,
    }
