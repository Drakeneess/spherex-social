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
                      s3={"addressing_style": "path"},
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
