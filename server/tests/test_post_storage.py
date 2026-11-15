"""Prove the S3 media budget, fallback and partial-write safety."""
from __future__ import annotations

import base64
import io
from uuid import uuid4

import numpy as np
import pytest
from fastapi import HTTPException
from PIL import Image

import post_storage
import sky_storage


@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "development")
    for key in ("SKY_S3_ENDPOINT", "SKY_S3_BUCKET", "SKY_S3_REGION",
                "SKY_S3_ACCESS_KEY", "SKY_S3_SECRET_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(post_storage, "LOCAL_STORE", tmp_path)
    monkeypatch.setattr(sky_storage, "LOCAL_STORE", tmp_path)
    return tmp_path


def data_url(image, format="PNG", **kwargs):
    buffer = io.BytesIO()
    image.save(buffer, format=format, **kwargs)
    mime = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[format]
    return f"data:image/{mime};base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def test_adaptive_webp_photo_and_thumbnail_stay_below_all_budgets():
    # A realistic high-frequency background is much harder to compress than
    # a flat-color dummy; check its encoded size instead of guessing a ratio.
    rng = np.random.default_rng(616)
    noise = Image.fromarray(rng.integers(0, 256, (900, 900, 3), dtype=np.uint8), "RGB")
    photo = post_storage.decode_image(data_url(noise, format="WEBP", quality=80))
    assert len(photo.full) <= post_storage.MAX_FULL_BYTES
    assert len(photo.thumbnail) <= post_storage.MAX_THUMB_BYTES
    assert photo.stored_size <= (650 + 100) * 1024
    assert photo.stored_size * 4 <= post_storage.MAX_POST_BYTES
    with Image.open(io.BytesIO(photo.full)) as full:
        assert full.format == "WEBP"
        assert max(full.size) <= 1600
        assert full.info.get("exif") is None
    with Image.open(io.BytesIO(photo.thumbnail)) as preview:
        assert preview.format == "WEBP"
        assert max(preview.size) <= 400
        assert preview.info.get("exif") is None
    # A random-noise source should not balloon again when optimized.
    assert len(photo.full) < len(base64.b64decode(data_url(noise,"WEBP",quality=80).split(",",1)[1]))


def test_large_input_downscales_within_1600_pixels_without_metadata():
    source = Image.new("RGB", (1920, 1280), (22, 43, 91))
    exif = Image.Exif()
    exif[271] = "Camera Maker"
    original = data_url(source, "JPEG", quality=90, exif=exif)
    photo = post_storage.decode_image(original)
    with Image.open(io.BytesIO(photo.full)) as full:
        assert full.size == (1600, 1067)
        assert full.getexif().get(271) is None
        assert full.info.get("exif") is None
    with Image.open(io.BytesIO(photo.thumbnail)) as thumb:
        assert thumb.size[0] == 400
        assert thumb.info.get("exif") is None


def test_two_variants_persist_and_legacy_images_fall_back(local_store):
    image = post_storage.decode_image(data_url(Image.new("RGB", (600, 400), "#334477")))
    media_id = uuid4()
    key = post_storage.put_post_image(media_id, image)
    full_file = local_store / key
    thumb_file = local_store / post_storage.thumbnail_key(key)
    assert full_file.exists() and thumb_file.exists()
    assert full_file.stat().st_size <= post_storage.MAX_FULL_BYTES
    assert thumb_file.stat().st_size <= post_storage.MAX_THUMB_BYTES
    assert post_storage.get_post_image(key, "full") == image.full
    assert post_storage.get_post_image(key, "thumbnail") == image.thumbnail
    with pytest.raises(ValueError):
        post_storage.get_post_image(key, "invalid")

    thumb_file.unlink()
    # Pre-optimization posts will contain only the full WebP, not a thumbnail.
    assert post_storage.get_post_image(key, "thumbnail") == image.full
    post_storage.delete_post_image(key)
    assert not full_file.exists() and not thumb_file.exists()


def test_partial_failure_cleans_up_full_and_thumbnail(local_store, monkeypatch):
    optimized = post_storage.decode_image(data_url(Image.new("RGB",(140,90),"#113355")))
    original_put = post_storage._put_bytes

    def fail_on_second_write(key, value, mime):
        if key.endswith(".thumb.webp"):
            raise OSError("S3 thumbnail upload failure")
        return original_put(key,value,mime)

    monkeypatch.setattr(post_storage, "_put_bytes", fail_on_second_write)
    identifier = uuid4()
    with pytest.raises(OSError, match="thumbnail"):
        post_storage.put_post_image(identifier,optimized)
    assert not (local_store/post_storage.media_key(identifier)).exists()
    assert not (local_store/post_storage.thumbnail_key(post_storage.media_key(identifier))).exists()


def test_invalid_photo_reference_and_oversized_variant_are_rejected(local_store):
    with pytest.raises(ValueError):
        post_storage.thumbnail_key("social/media/v1/../../someone.webp")
    with pytest.raises(ValueError):
        post_storage.get_post_image("social/media/v1/invalid.webp")
    with pytest.raises(ValueError):
        post_storage.put_post_image(
            uuid4(),post_storage.OptimizedPhoto(full=b"RIFF"+b"x"*post_storage.MAX_FULL_BYTES,
                                                thumbnail=b"RIFFotherWEBP"),
        )
    with pytest.raises(HTTPException) as error:
        post_storage.decode_image("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
    assert error.value.status_code == 422
