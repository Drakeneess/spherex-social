"""Read-only SPHEREx catalog fallback through IRSA TAP/UWS.

A TAP submission is a non-idempotent remote POST. We durably record the
submission intent BEFORE making it. If IRSA returns 502 without confirming
creation, this sky job fails with a clear message instead of creating an
unknown number of duplicate jobs. Once a job URL is known, polling and result
retrieval can resume after local worker restarts WITHOUT resubmission.

This module never downloads FITS or changes the selected science images.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger("astrogram.sky.tap")
POLL_INTERVAL_SECONDS = 3
MAX_TAP_SECONDS = 240
MAX_POLL_ERRORS = 4
MAX_TAP_RECORDS = 5000
WAITING = frozenset({"PENDING", "QUEUED", "EXECUTING", "HELD", "SUSPENDED", "UNKNOWN"})


class TapFallbackError(Exception):
    """Safe, user-facing status for a catalog attempt (no URLs or secrets)."""


def _service():
    from astroquery.ipac.irsa import Irsa
    return Irsa.tap


def _submit(query: str):
    return _service().submit_job(query, maxrec=MAX_TAP_RECORDS + 1)


def _restore(url: str):
    from pyvo.dal.tap import AsyncTAPJob
    from app import validate_uws_job_url

    # Reject unexpected hosts and paths BEFORE constructing the network
    # client; otherwise a compromised DB entry would be an SSRF route.
    class RecordedURL:
        def __init__(self, raw: str):
            self.url = raw
    checked = validate_uws_job_url(RecordedURL(url))
    if checked != url.rstrip("/"):
        raise TapFallbackError("El identificador del trabajo TAP no es válido.")
    return AsyncTAPJob(checked, session=getattr(_service(), "_session", None), delete=False)


def retrieve_tap_catalog(
    ra: float, dec: float, size_arcmin: float, detector: int,
    prior: dict | None, persist: Callable[[dict], None],
    sia2_failure: str = "SIA2 no respondió",
) -> tuple[list[dict], dict]:
    """Return vetted FITS cutout records and public discovery metadata.

    persist() saves JSON state to the current sky job using the lease-owner
    check. All keys beginning with "_" are private and MUST be stripped by
    the HTTP snapshot before returning discovery metadata to browsers.
    """
    from app import make_irsa_query, records_from_tap, validate_uws_job_url

    state = dict(prior or {})
    reason = str(state.get("sia2_error") or sia2_failure)[:170]
    if not state.get("_tap_submission_started"):
        # This marker is deliberately saved even if the remote POST fails.
        # A subsequent worker must not automatically submit again.
        state = {
            "method": "tap", "fallback_from": "sia2",
            "sia2_error": reason,
            "phase": "submitting",
            "_tap_submission_started": True,
            "_tap_started_at": time.time(),
        }
        persist(state)
        try:
            remote = _submit(make_irsa_query(ra, dec, size_arcmin, detector))
        except Exception as exc:
            logger.warning("TAP async submission unconfirmed: %s", type(exc).__name__)
            raise TapFallbackError(
                f"SIA2 no está disponible ({reason}). "
                "IRSA tampoco confirmó la creación del trabajo TAP. "
                "No se reintentó automáticamente para evitar trabajos duplicados."
            ) from exc
        try:
            url = validate_uws_job_url(remote)
            if not url:
                raise ValueError("Missing remote UWS URL")
        except Exception as exc:
            raise TapFallbackError(
                "IRSA creó un trabajo TAP, pero no proporcionó un identificador seguro. "
                "No se enviará otra solicitud automáticamente."
            ) from exc
        state.update({"_tap_job_url": url, "phase": "PENDING"})
        persist(state)
    else:
        url = state.get("_tap_job_url")
        if not isinstance(url, str) or not url:
            raise TapFallbackError(
                f"SIA2 no está disponible ({reason}). La creación de TAP quedó "
                "sin confirmar; no se envió un trabajo duplicado."
            )
        try:
            remote = _restore(url)
        except TapFallbackError:
            raise
        except Exception as exc:
            raise TapFallbackError(
                "No se pudo reconectar con el trabajo TAP archivado en IRSA."
            ) from exc

    if not state.get("_tap_run_requested"):
        # Record the run request before transmitting it, for crash-safety.
        state["_tap_run_requested"] = True
        state["phase"] = "STARTING"
        persist(state)
        try:
            remote.run()
        except Exception as exc:
            logger.warning("TAP execution start not confirmed: %s", type(exc).__name__)
            raise TapFallbackError(
                "IRSA recibió el trabajo TAP, pero no confirmó su ejecución. "
                "Conservamos el identificador remoto y evitamos iniciarlo dos veces."
            ) from exc

    deadline = float(state.get("_tap_started_at") or time.time()) + MAX_TAP_SECONDS
    consecutive_errors = 0
    last_phase = ""
    while time.time() < deadline:
        try:
            phase = str(remote.phase).strip().upper()
            consecutive_errors = 0
        except Exception as exc:
            consecutive_errors += 1
            logger.warning("TAP phase check unavailable (%s): %s",
                           consecutive_errors, type(exc).__name__)
            if consecutive_errors > MAX_POLL_ERRORS:
                raise TapFallbackError(
                    f"SIA2 no está disponible ({reason}) y TAP dejó de responder "
                    "al consultar el estado del trabajo remoto."
                ) from exc
            # A bounded transient retry is safe for GET/poll, not for POST.
            time.sleep(min(12, POLL_INTERVAL_SECONDS * consecutive_errors))
            continue
        if phase != last_phase:
            state["phase"] = phase
            persist(state)
            last_phase = phase
        if phase in ("ERROR", "ABORTED"):
            raise TapFallbackError(
                f"SIA2 no está disponible ({reason}); el trabajo TAP terminó "
                f"con estado {phase}."
            )
        if phase == "COMPLETED":
            for retry in range(1, MAX_POLL_ERRORS + 2):
                try:
                    table = remote.fetch_result()
                    records = records_from_tap(table)
                    if len(table) > MAX_TAP_RECORDS:
                        raise TapFallbackError(
                            "TAP devolvió más de 5000 observaciones. "
                            "Reduce el campo o cambia de detector para evitar resultados incompletos."
                        )
                    state["phase"] = "COMPLETED"
                    state["elapsed_ms"] = round(
                        (time.time() - float(state["_tap_started_at"])) * 1000
                    )
                    persist(state)
                    return records, {
                        "method": "tap", "fallback_from": "sia2",
                        "sia2_error": reason, "phase": "COMPLETED",
                        "elapsed_ms": state["elapsed_ms"],
                        "attempts": 1,
                    }
                except TapFallbackError:
                    raise
                except Exception as exc:
                    logger.warning("TAP result fetch attempt %s failed (%s)",
                                   retry, type(exc).__name__)
                    if retry > MAX_POLL_ERRORS:
                        raise TapFallbackError(
                            "El trabajo TAP terminó, pero IRSA no permitió leer el catálogo."
                        ) from exc
                    time.sleep(POLL_INTERVAL_SECONDS * retry)
        if phase not in WAITING:
            raise TapFallbackError("IRSA TAP devolvió un estado inesperado.")
        # Verify lease/cancellation at every phase check and give polling tabs
        # a fresh heartbeat even when the remote phase is unchanged.
        persist(state)
        time.sleep(POLL_INTERVAL_SECONDS)

    raise TapFallbackError(
        f"SIA2 no está disponible ({reason}) y TAP no terminó "
        "dentro de cuatro minutos. No se inventaron observaciones."
    )
