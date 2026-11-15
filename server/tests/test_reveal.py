"""FITS-backed rendering, storage boundaries, and recipe validation."""
import base64
import io
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app as explorer
import persistent_sky
import sky_storage
from sky_reveal import RevealRecipe, reveal_png
from social_api.db import Base
from social_api.models import SkySearchJob


def test_non_destructive_display_recipes_and_formats():
    pixels = np.linspace(-3, 12, 10000, dtype=np.float32).reshape(100, 100)
    pixels[13, 15] = np.nan
    before = pixels.copy()
    for palette in ("gray", "cyan", "violet", "ember", "custom"):
        recipe = RevealRecipe(palette=palette, highlight="#00ccee", shadow="#080921",
                              format="portrait", stretch="asinh", sampling="smooth")
        result = reveal_png(pixels, recipe)
        assert result.startswith("data:image/png;base64,")
        with Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1]))) as image:
            assert image.mode == "RGB" and image.size == (600, 750)
            assert image.getpixel((0, 0)) == (3, 5, 13)
    assert np.array_equal(before, pixels, equal_nan=True)
    wide = reveal_png(pixels, RevealRecipe(format="wide", sampling="pixels"))
    with Image.open(io.BytesIO(base64.b64decode(wide.split(",", 1)[1]))) as image:
        assert image.size == (800, 450)
    for invalid in ({"palette": "infrared-physical"}, {"gamma": 10},
                    {"black": float("inf")}, {"highlight": "red"}, {"other": True}):
        with pytest.raises(Exception):
            RevealRecipe(**invalid)


def test_science_store_keeps_fits_and_unscaled_floats(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "development")
    for key in ("SKY_S3_ENDPOINT", "SKY_S3_BUCKET", "SKY_S3_REGION",
                "SKY_S3_ACCESS_KEY", "SKY_S3_SECRET_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(sky_storage, "LOCAL_STORE", tmp_path)
    job = uuid.uuid4()
    data = np.array([[0.001, 2345.5], [np.nan, -32.125]], dtype=np.float32)
    raw = b"SIMPLE  " + b"0" * 2800
    sky_storage.put_science(job, 0, raw, data)
    assert sky_storage.get_source_fits(job, 0) == raw
    assert np.array_equal(sky_storage.get_science_pixels(job, 0), data, equal_nan=True)
    with pytest.raises(ValueError):
        sky_storage.put_science(job, 17, raw, data)
    with pytest.raises(ValueError):
        sky_storage.put_science(job, 1, b"garbage", data)
    with pytest.raises(ValueError):
        sky_storage.put_science(job, 1, raw, np.zeros((400, 400), dtype=np.float32))


def test_reveal_endpoint_only_allows_ready_real_fits(monkeypatch):
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread":False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(persistent_sky, "get_session_factory", lambda: maker)
    job_id = uuid.uuid4()
    with Session(engine) as db:
        db.add(SkySearchJob(
            id=job_id, ra=133.795129, dec=-7.245147, size_arcmin=6,
            detector=2, max_frames=3, status="complete", demo=False,
            frame_states=[
                {"index": 0, "status": "ready", "metadata": {"raw_available": True}},
                {"index": 1, "status": "ready", "metadata": {}},
                {"index": 2, "status": "failed"},
            ],
        ))
        db.commit()
    count = []
    def read_pixels(jid, index):
        count.append((jid, index))
        return np.arange(100, dtype=np.float32).reshape(10, 10)
    monkeypatch.setattr(persistent_sky, "get_science_pixels", read_pixels)
    with TestClient(explorer.app) as client:
        state = client.get(f"/api/sky/jobs/{job_id}").json()
        assert state["frames"][0]["raw_available"] is True
        assert state["frames"][1]["raw_available"] is False
        path = f"/api/sky/jobs/{job_id}/frames"
        ok = client.post(f"{path}/0/reveal", json={"palette": "cyan", "format": "square"})
        assert ok.status_code == 200, ok.text
        assert ok.json()["recipe"]["palette"] == "cyan"
        assert ok.json()["derived"] is True
        assert ok.json()["image"].startswith("data:image/png;base64,")
        assert "fits" not in ok.json()  # science bytes never leak
        assert count == [(job_id, 0)]
        assert client.post(f"{path}/1/reveal", json={}).status_code == 409
        assert client.post(f"{path}/2/reveal", json={}).status_code == 404
        assert client.post(f"{path}/3/reveal", json={}).status_code == 404
        assert client.post(f"{path}/0/reveal", json={"white": 500}).status_code == 422
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_real_fits_cutout_is_preserved_before_8bit_reveal(monkeypatch, tmp_path):
    """Exercise the real ingestion with a local synthetic FITS, without IRSA network."""
    from astropy.io import fits
    from astropy.wcs import WCS

    target = WCS(naxis=2)
    target.wcs.crval = [133.795129, -7.245147]
    target.wcs.crpix = [24.5, 24.5]
    target.wcs.cdelt = [-6/3600, 6/3600]
    target.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    source = np.arange(48 * 48, dtype=np.float32).reshape(48, 48)
    cutout = tmp_path / "real.fits"
    fits.HDUList([fits.PrimaryHDU(),
                  fits.ImageHDU(data=source, header=target.to_header(), name="IMAGE")]
                 ).writeto(cutout)
    monkeypatch.setattr(explorer, "ensure_irsa_cutout_url", lambda _url: True)
    record = {"url": str(cutout), "date": "2025-05-15T00:00:00", "release": "DR1"}
    session = explorer.Session(
        ra=133.795129, dec=-7.245147, size_arcmin=6,
        detector=2, records=[record], source="sia2", archive_science=True,
    )
    result = explorer.render_real(session, record)
    assert result["mode"] == "real"
    assert result["image"].startswith("data:image/png;base64,")
    assert result["science_fits"].startswith(b"SIMPLE  ")
    assert result["science_pixels"].dtype == np.float32
    with fits.open(io.BytesIO(result["science_fits"])) as restored:
        assert np.array_equal(restored["IMAGE"].data, source)
        assert restored["IMAGE"].header["CTYPE1"] == "RA---TAN"
