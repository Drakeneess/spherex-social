"""Store generated preview PNGs outside PostgreSQL and process memory.

Railway production uses a private S3-compatible bucket. Local development
uses a persistent, non-versioned directory on disk. No URLs or credentials
are returned to browser clients.
"""
from __future__ import annotations

import base64
import os
from functools import lru_cache
from pathlib import Path
from uuid import UUID

PNG_PREFIX = "data:image/png;base64,"
PNG_SIGNATURE = bytes.fromhex("89504e470d0a1a0a")
MAX_PNG_BYTES = 4 * 1024 * 1024
LOCAL_STORE = Path(__file__).resolve().parent / ".sky-frames"


def _object_key(job_id: UUID, frame_index: int) -> str:
    if frame_index < 0 or frame_index >= 16:
        raise ValueError("Invalid frame index")
    return f"sky/v1/{job_id}/{frame_index:02d}.png"


def _s3_settings() -> tuple[str, str, str, str, str] | None:
    values = tuple(os.environ.get(name, "") for name in (
        "SKY_S3_ENDPOINT", "SKY_S3_BUCKET", "SKY_S3_REGION",
        "SKY_S3_ACCESS_KEY", "SKY_S3_SECRET_KEY",
    ))
    if all(values):
        if not values[0].startswith("https://"):
            raise RuntimeError("S3 storage endpoint must use HTTPS")
        return values
    if os.environ.get("APP_ENV", "development").lower() == "production":
        raise RuntimeError("Private S3 bucket is required for production sky frames")
    return None


@lru_cache(maxsize=4)
def _client(endpoint: str, access_key: str, secret_key: str, region: str):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3", endpoint_url=endpoint,
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(signature_version="s3v4",
                      s3={"addressing_style": os.environ.get("SKY_S3_ADDRESSING_STYLE", "virtual")},
                      retries={"max_attempts": 3, "mode": "standard"}),
    )


def put_preview(job_id: UUID, frame_index: int, data_url: str) -> str:
    if not data_url.startswith(PNG_PREFIX):
        raise ValueError("Expected a PNG data URL")
    raw = base64.b64decode(data_url[len(PNG_PREFIX):], validate=True)
    if not raw.startswith(PNG_SIGNATURE) or len(raw) > MAX_PNG_BYTES:
        raise ValueError("Invalid or oversized PNG")
    key = _object_key(job_id, frame_index)
    settings = _s3_settings()
    if settings is None:
        target = LOCAL_STORE / key
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(raw)
        tmp.replace(target)
    else:
        endpoint, bucket, region, access, secret = settings
        _client(endpoint, access, secret, region).put_object(
            Bucket=bucket, Key=key, Body=raw, ContentType="image/png",
            CacheControl="private, max-age=3600",
        )
    return key


def get_preview(job_id: UUID, frame_index: int) -> str:
    key = _object_key(job_id, frame_index)
    settings = _s3_settings()
    if settings is None:
        raw = (LOCAL_STORE / key).read_bytes()
    else:
        endpoint, bucket, region, access, secret = settings
        raw = _client(endpoint, access, secret, region).get_object(
            Bucket=bucket, Key=key,
        )["Body"].read(MAX_PNG_BYTES + 1)
    if not raw.startswith(PNG_SIGNATURE) or len(raw) > MAX_PNG_BYTES:
        raise ValueError("Invalid stored PNG")
    return PNG_PREFIX + base64.b64encode(raw).decode("ascii")

# Scientific material is never returned directly by public frame endpoints.
# FITS is the original science cutout reserialized with unchanged pixel values
# and headers, and NPZ holds its unnormalized 2D reprojection for fast editing.
MAX_FITS_BYTES = 32 * 1024 * 1024
MAX_SCIENCE_BYTES = 3 * 1024 * 1024


def _science_key(job_id: UUID, frame_index: int, extension: str) -> str:
    _object_key(job_id, frame_index)  # reuse central index validation
    if extension not in ("fits", "npz"):
        raise ValueError("Unsupported scientific format")
    return f"sky/science/v1/{job_id}/{frame_index:02d}.{extension}"


def _put_bytes(key: str, raw: bytes, mime: str) -> None:
    settings = _s3_settings()
    if settings is None:
        target = LOCAL_STORE / key
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(raw)
        tmp.replace(target)
    else:
        endpoint, bucket, region, access, secret = settings
        _client(endpoint, access, secret, region).put_object(
            Bucket=bucket, Key=key, Body=raw, ContentType=mime,
            CacheControl="private, max-age=3600",
        )


def _get_bytes(key: str, max_bytes: int) -> bytes:
    settings = _s3_settings()
    if settings is None:
        with (LOCAL_STORE / key).open("rb") as fh:
            raw = fh.read(max_bytes + 1)
    else:
        endpoint, bucket, region, access, secret = settings
        raw = _client(endpoint, access, secret, region).get_object(
            Bucket=bucket, Key=key,
        )["Body"].read(max_bytes + 1)
    if not raw or len(raw) > max_bytes:
        raise ValueError("Scientific source is missing or oversized")
    return raw


def put_science(job_id: UUID, frame_index: int, fits_bytes: bytes, pixels) -> None:
    import io
    import numpy as np

    if not fits_bytes.startswith(b"SIMPLE  ") or len(fits_bytes) > MAX_FITS_BYTES:
        raise ValueError("Invalid or oversized FITS cutout")
    data = np.asarray(pixels, dtype=np.float32)
    if data.ndim != 2 or not all(1 <= size <= 256 for size in data.shape):
        raise ValueError("Invalid reprojection dimensions")
    with io.BytesIO() as stream:
        np.savez_compressed(stream, pixels=data)
        compressed = stream.getvalue()
    if len(compressed) > MAX_SCIENCE_BYTES:
        raise ValueError("Oversized reprojection")
    _put_bytes(_science_key(job_id, frame_index, "fits"),
               fits_bytes, "application/fits")
    _put_bytes(_science_key(job_id, frame_index, "npz"),
               compressed, "application/octet-stream")


def get_science_pixels(job_id: UUID, frame_index: int):
    import io
    import numpy as np

    raw = _get_bytes(_science_key(job_id, frame_index, "npz"), MAX_SCIENCE_BYTES)
    with np.load(io.BytesIO(raw), allow_pickle=False) as data:
        pixels = np.asarray(data["pixels"], dtype=np.float32)
    if pixels.ndim != 2 or not all(1 <= size <= 256 for size in pixels.shape):
        raise ValueError("Corrupt stored reprojection")
    return pixels


def get_source_fits(job_id: UUID, frame_index: int) -> bytes:
    """Internal-only access for future authenticated scientific exports."""
    return _get_bytes(_science_key(job_id, frame_index, "fits"), MAX_FITS_BYTES)
