"""Synthetic registration tests: no demo image is used as scientific evidence."""
import numpy as np
import pytest

from sky_candidate_search import analyze_motion


def frame(seed: int, moving=None, spike=None, shape=(80, 80)):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:shape[0], :shape[1]]
    picture = rng.normal(0, .75, shape).astype(np.float32)
    # Dense but stationary background: must subtract out across epochs.
    for x,y,a in ((15,20,34),(51,59,27),(60,14,22),(20,66,32),(62,44,29)):
        picture += a * np.exp(-((xx-x)**2+(yy-y)**2)/(2*1.2**2))
    if moving is not None:
        x,y = moving
        picture += 35 * np.exp(-((xx-x)**2+(yy-y)**2)/(2*1.2**2))
    if spike is not None:
        x,y = spike
        picture[y,x] += 180
    return picture.astype(np.float32)


def test_three_epoch_linear_mover_found_not_stationary_stars():
    samples = [(i, 60600.+i*26,
                frame(i+10, moving=(27+i*3, 28+i*1.2)))
               for i in range(5)]
    result = analyze_motion(samples, 134.0, -8.0)
    assert result["status"] == "candidates", result
    assert len(result["candidates"]) >= 1
    tracks = result["candidates"]
    best = min(tracks, key=lambda row:
               abs(row["detections"][0]["x"]*79-27))
    assert best["support"] >= 3
    assert best["shift_px"] >= 2.1
    assert best["fit_rms_px"] <= .85
    assert 0 <= best["ra_deg"] < 360
    assert -90 <= best["dec_deg"] <= 90
    assert all(0 <= p["x"] <= 1 and 0 <= p["y"] <= 1 for p in best["detections"])


def test_stars_without_motion_do_not_produce_tracklets():
    samples = [(i, 60600.+i*25,frame(i+90)) for i in range(5)]
    result = analyze_motion(samples, 134.0, -8.0)
    assert result["status"] == "no_candidates", result


def test_two_epochs_are_not_sufficient_to_claim_a_motion_track():
    samples = [(i, 60600.+i*35,frame(i+10, moving=(22+i*4,24)))
               for i in range(2)]
    result = analyze_motion(samples, 134.0, -8.0)
    assert result["status"] == "insufficient"
    assert not result["candidates"]


def test_single_pixel_cosmic_spikes_not_a_moving_object():
    samples = [(i,60600.+i*25,frame(i+10, spike=(24+i*3,26+i)))
               for i in range(5)]
    result=analyze_motion(samples,134.0,-8.0)
    assert result["status"] == "no_candidates",result


def test_mismatched_arrays_are_not_reprojected_implicitly():
    with pytest.raises(ValueError):
        analyze_motion([(0,60600,frame(1)),(1,60620,frame(2)),
                        (2,60640,frame(3,shape=(64,64)))],134,-8)


def test_same_night_cannot_prove_month_scale_motion():
    samples=[(i,60600.+i*.1,frame(i+10,moving=(25+i*3,28)))
             for i in range(3)]
    result=analyze_motion(samples,134,-8)
    assert result["status"]=="insufficient"


def test_missing_fits_coverage_does_not_fabricate_sources():
    samples=[(i,60600+i*25,np.full((80,80),np.nan,dtype=np.float32))
             for i in range(3)]
    with pytest.raises(ValueError):
        analyze_motion(samples,134,-8)
