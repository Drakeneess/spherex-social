from app import evenly_spaced, ensure_irsa_cutout_url, make_target_wcs, normalize_preview
import numpy as np


def test_evenly_spaced_keeps_ends():
    assert evenly_spaced(list(range(100)), 4)[0] == 0
    assert evenly_spaced(list(range(100)), 4)[-1] == 99


def test_no_arbitrary_host():
    assert not ensure_irsa_cutout_url("http://127.0.0.1/admin?center=1&size=2")
    assert not ensure_irsa_cutout_url("https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/a.fits?center=1&size=2")


def test_reference_grid():
    wcs, pixels = make_target_wcs(180, 45, 6)
    assert pixels == 60
    assert wcs.wcs.cdelt[0] < 0 < wcs.wcs.cdelt[1]


def test_nan_display():
    assert normalize_preview(np.array([[np.nan, 1.0], [2.0, 10.0]])).dtype == np.uint8
