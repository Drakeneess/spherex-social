"""Bounded exploratory search for linear-moving point-source candidates.

Input: *real*, co-registered, unnormalized SPHEREx FITS reprojections.
All frames share the fixed TAN WCS created by app.make_target_wcs.
This is NOT calibrated image differencing, orbital fitting, source identification,
a detection significance measurement, or evidence for Planet Nine.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

import numpy as np
from astropy.wcs import WCS
from scipy.ndimage import gaussian_filter, maximum_filter

MAX_EPOCHS = 16
MAX_SIDE = 256
MAX_PEAKS_PER_EPOCH = 28
MIN_SUPPORT = 3
MIN_BASELINE_DAYS = 1.0
MIN_TOTAL_DRIFT_PX = 2.1
MAX_TOTAL_DRIFT_PX = 48.0
PEAK_Z = 5.0
MATCH_TOLERANCE_PX = 1.15
PIXEL_ARCSEC = 6.0


@dataclass(frozen=True)
class Peak:
    epoch: int
    mjd: float
    x: float
    y: float
    snr: float
    ordinal: int

    @property
    def key(self) -> tuple[int, int]:
        return self.epoch, self.ordinal


def _robust_sigma(samples: np.ndarray) -> float:
    if not len(samples):
        return 0.0
    center = np.median(samples)
    return float(1.4826 * np.median(np.abs(samples - center)))


def _highpass(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    finite = np.isfinite(frame)
    if np.count_nonzero(finite) < frame.size * 0.65:
        raise ValueError("Unusable FITS coverage")
    # Avoid interpolating missing corners as zero, which creates false peaks.
    weight = finite.astype(np.float32)
    filled = np.where(finite, frame, 0.0).astype(np.float32)
    local_weight = gaussian_filter(weight, 1.0, mode="nearest")
    broad_weight = gaussian_filter(weight, 4.0, mode="nearest")
    local = gaussian_filter(filled, 1.0, mode="nearest") / np.maximum(local_weight, 1e-5)
    broad = gaussian_filter(filled, 4.0, mode="nearest") / np.maximum(broad_weight, 1e-5)
    good = finite & (local_weight > 0.98) & (broad_weight > 0.94)
    residual = local - broad
    median = float(np.median(residual[good]))
    noise = _robust_sigma(residual[good])
    if noise < 1e-9 or not math.isfinite(noise):
        # Flat frames do not contribute any source detections.
        return np.zeros_like(frame, dtype=np.float32), good, broad
    return ((residual - median) / noise).astype(np.float32), good, broad


def _peaks(index: int, mjd: float, z: np.ndarray,
           good: np.ndarray, raw: np.ndarray,
           background: np.ndarray, threshold: float) -> list[Peak]:
    h, w = z.shape
    maxima = maximum_filter(z, size=5, mode="nearest")
    ys, xs = np.where(
        good & (z >= threshold) & (z >= maxima - 1e-5)
    )
    options = sorted(zip(ys.tolist(), xs.tolist()),
                     key=lambda xy: -float(z[xy]))[:MAX_PEAKS_PER_EPOCH * 3]
    result: list[Peak] = []
    for y, x in options:
        if x < 5 or y < 5 or x >= w-5 or y >= h-5:
            continue
        if not np.all(good[y-1:y+2, x-1:x+2]):
            continue
        patch = np.maximum(raw[y-1:y+2, x-1:x+2] - background[y-1:y+2, x-1:x+2], 0)
        total = float(patch.sum())
        if total <= 0:
            continue
        # Reject many isolated cosmic-ray / hot-pixel spikes; not a PSF fit.
        if float(patch[1, 1]) / total > 0.73:
            continue
        # Centroid in the same reprojection grid. Avoid independently stretched PNGs.
        weights = np.maximum(z[y-1:y+2, x-1:x+2], 0)
        norm = float(weights.sum())
        if norm <= 0:
            continue
        dx = float(np.sum(weights * np.array([-1, 0, 1])[None, :]) / norm)
        dy = float(np.sum(weights * np.array([-1, 0, 1])[:, None]) / norm)
        if any((x+dx-p.x)**2 + (y+dy-p.y)**2 < 2.5**2 for p in result):
            continue
        result.append(Peak(index, mjd, x+dx, y+dy, float(z[y, x]), len(result)))
        if len(result) >= MAX_PEAKS_PER_EPOCH:
            break
    return result


def _fit_track(points: list[Peak]) -> tuple[float, float, float, float, float]:
    ts = np.array([p.mjd for p in points], dtype=np.float64)
    xs = np.array([p.x for p in points], dtype=np.float64)
    ys = np.array([p.y for p in points], dtype=np.float64)
    t0 = float(np.median(ts))
    design = np.stack((np.ones(len(ts)), ts-t0), axis=1)
    xc, *_ = np.linalg.lstsq(design, xs, rcond=None)
    yc, *_ = np.linalg.lstsq(design, ys, rcond=None)
    rms = float(np.sqrt(np.mean(
        (design @ xc - xs)**2 + (design @ yc - ys)**2
    )))
    return float(xc[0]), float(yc[0]), float(xc[1]), float(yc[1]), rms


def _candidate_tracks(epochs: list[tuple[int, float, list[Peak]]],
                      h: int, w: int, ra: float, dec: float) -> list[dict]:
    count = len(epochs)
    # The same reprojection as the archived FITS, not the display PNG.
    from app import make_target_wcs
    wcs, pixels = make_target_wcs(ra, dec, (w * PIXEL_ARCSEC) / 60)
    if pixels != w:
        # Scientific coordinates must never be manufactured from a mismatched grid.
        return []
    tracks: dict[frozenset[tuple[int, int]], dict] = {}
    for i in range(count-2):
        _, ta, left = epochs[i]
        if not left:
            continue
        for j in range(i+2, count):
            _, tb, right = epochs[j]
            dt = tb - ta
            if dt < MIN_BASELINE_DAYS:
                continue
            for a in left:
                for b in right:
                    travel = math.hypot(b.x-a.x, b.y-a.y)
                    if not MIN_TOTAL_DRIFT_PX <= travel <= MAX_TOTAL_DRIFT_PX:
                        continue
                    vx, vy = (b.x-a.x)/dt, (b.y-a.y)/dt
                    if math.hypot(vx, vy) > 5.0:
                        continue
                    fitted: list[Peak] = []
                    for _, t, observed in epochs:
                        if not observed:
                            continue
                        px = a.x + vx*(t-ta)
                        py = a.y + vy*(t-ta)
                        # No extrapolation beyond the field is useful.
                        if px < 4 or py < 4 or px >= w-4 or py >= h-4:
                            continue
                        near = min(observed, key=lambda p: (p.x-px)**2 + (p.y-py)**2)
                        if math.hypot(near.x-px, near.y-py) <= MATCH_TOLERANCE_PX:
                            fitted.append(near)
                    if len(fitted) < MIN_SUPPORT:
                        continue
                    # Suppress isolated alignments in fields with many sources.
                    if count > 5 and len(fitted) < max(MIN_SUPPORT, math.ceil(count * .38)):
                        continue
                    _, _, fx, fy, rms = _fit_track(fitted)
                    span = fitted[-1].mjd - fitted[0].mjd
                    shift = math.hypot(fx,fy) * span
                    if (span < MIN_BASELINE_DAYS or
                            shift < MIN_TOTAL_DRIFT_PX or shift > MAX_TOTAL_DRIFT_PX or
                            rms > 0.85):
                        continue
                    keys = frozenset(point.key for point in fitted)
                    score = (
                        len(fitted) * float(np.median([p.snr for p in fitted]))
                        * min(1.0,shift/4.0) / (1.0+rms)
                    )
                    prev = tracks.get(keys)
                    if prev is None or score > prev["score"]:
                        # Report coordinates at the first actual observation.
                        first = fitted[0]
                        sky_ra, sky_dec = wcs.all_pix2world(first.x, first.y, 0)
                        if not (math.isfinite(sky_ra) and math.isfinite(sky_dec)):
                            continue
                        tracks[keys] = {
                            "score": round(score, 2),
                            "support": len(fitted),
                            "span_days": round(span, 3),
                            "shift_px": round(shift, 2),
                            "motion_arcsec_day": round(math.hypot(fx, fy)*PIXEL_ARCSEC, 4),
                            "fit_rms_px": round(rms, 3),
                            "ra_deg": round(float(sky_ra) % 360, 6),
                            "dec_deg": round(float(sky_dec), 6),
                            "detections": [
                                {
                                    "index": p.epoch,
                                    "mjd": round(p.mjd, 5),
                                    "x": round(p.x/(w-1), 5),
                                    # PNG and browser Y are down, FITS grid Y is up.
                                    "y": round(1 - p.y/(h-1), 5),
                                    "snr_proxy": round(p.snr, 2),
                                }
                                for p in fitted
                            ],
                        }
    ordered = sorted(tracks.items(), key=lambda item: -item[1]["score"])
    unique: list[dict] = []
    accepted: list[frozenset[tuple[int, int]]] = []
    for keys, candidate in ordered:
        # Nearly identical fits share detections; keep only the strongest.
        if any(len(keys & other) >= max(2, int(min(len(keys),len(other))*.6)) for other in accepted):
            continue
        accepted.append(keys)
        candidate["id"] = f"C{len(unique)+1:03d}"
        unique.append(candidate)
        if len(unique) >= 20:
            break
    return unique


def analyze_motion(frames: list[tuple[int, float, np.ndarray]],
                   ra_deg: float, dec_deg: float) -> dict:
    """Find *candidates*, never claim a confirmed astronomical detection.

    Each tuple is (archive frame index, MJD, 2D float reprojection).
    There is no catalog matching, PSF homogenization, formal noise propagation,
    or treatment of variable spectral response. These are inspection hints only.
    """
    if len(frames) > MAX_EPOCHS:
        raise ValueError("Too many epochs")
    if len(frames) < MIN_SUPPORT:
        return {"status":"insufficient", "frames_used":len(frames), "candidates":[],
                "message":"Se necesitan al menos tres épocas FITS para evaluar una trayectoria."}
    ordered = sorted(frames, key=lambda item: item[1])
    shape = np.asarray(ordered[0][2]).shape
    if len(shape)!=2 or shape[0] != shape[1] or not 24 <= shape[0] <= MAX_SIDE:
        raise ValueError("Unexpected reprojection shape")
    if any((np.asarray(item[2]).shape != shape or
            not math.isfinite(item[1]) or item[0] < 0) for item in ordered):
        raise ValueError("Invalid or mismatched epochs")
    if len({i for i,_,_ in ordered}) != len(ordered):
        raise ValueError("Duplicate epoch indices")
    if ordered[-1][1]-ordered[0][1] < MIN_BASELINE_DAYS:
        return {"status":"insufficient","frames_used":len(ordered),"candidates":[],
                "message":"Las épocas disponibles están demasiado próximas en el tiempo."}
    zstack, valid_masks, baselines = [], [], []
    for _,_,frame in ordered:
        arr = np.asarray(frame, dtype=np.float32)
        if np.isinf(arr).any():
            raise ValueError("Invalid infinite FITS values")
        z, good, background = _highpass(arr)
        zstack.append(np.where(good,z,np.nan))
        valid_masks.append(good)
        baselines.append(background)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        median = np.nanmedian(np.stack(zstack),axis=0)
    stack = np.stack(zstack)
    coverage = np.sum(np.isfinite(stack),axis=0)
    # An epoch-independent source should largely disappear in this median image.
    template = np.where(np.isfinite(median)&(coverage>=3), median, 0.0)
    epochs = []
    for (index,mjd,frame), z,good,broad in zip(ordered, zstack,valid_masks,baselines):
        residual = np.nan_to_num(z-template,nan=-100.0,posinf=-100.0,neginf=-100.0)
        # At least three valid registered epoch samples per pixel.
        reliable = good & (coverage >= 3)
        found = _peaks(index,mjd,residual,reliable,
                       np.asarray(frame,dtype=np.float32),broad,PEAK_Z)
        epochs.append((index,mjd,found))
    candidates = _candidate_tracks(epochs,shape[0],shape[1],ra_deg,dec_deg)
    return {
        "status":"candidates" if candidates else "no_candidates",
        "frames_used":len(ordered),
        "candidates":candidates,
        "message":(
            f"{len(candidates)} trayectorias preliminares para inspeccionar."
            if candidates else
            "No se identificaron trayectorias que cumplan los filtros de esta búsqueda. "
            "Esto no descarta objetos reales."
        ),
    }
