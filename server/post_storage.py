"""Validate astronomy community photos and store privacy-safe WebP in private S3."""
from __future__ import annotations
import base64
import io
from uuid import UUID
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sky_storage import _put_bytes, _get_bytes, _s3_settings, _client, LOCAL_STORE

MAX_INPUT=3*1024*1024
MAX_OUTPUT=3*1024*1024
MAX_PIXELS=16_000_000
PREFIXES=('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')
ROOT='social/media/v1/'


def media_key(media_id:UUID)->str:
    return f'{ROOT}{media_id}.webp'


def decode_image(data_url:str)->bytes:
    prefix=next((p for p in PREFIXES if data_url.startswith(p)),None)
    if prefix is None:
        raise HTTPException(status_code=422,detail='Formatos admitidos: JPEG, PNG y WebP')
    encoded=data_url[len(prefix):]
    if len(encoded)>MAX_INPUT*4//3+8:
        raise HTTPException(status_code=413,detail='Imagen demasiado grande (máximo 3 MB)')
    try:
        raw=base64.b64decode(encoded,validate=True)
        if not raw or len(raw)>MAX_INPUT: raise ValueError('oversized')
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in ('JPEG','PNG','WEBP'):
                raise ValueError('unsupported')
            if source.width<1 or source.height<1 or source.width*source.height>MAX_PIXELS:
                raise ValueError('dimensions')
            image=ImageOps.exif_transpose(source)
            image=image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
            image.thumbnail((1920,1920),Image.Resampling.LANCZOS)
            for quality in (84,74,60):
                output=io.BytesIO()
                image.save(output,'WEBP',quality=quality,method=4)
                data=output.getvalue()
                if len(data)<=MAX_OUTPUT: return data
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError,base64.binascii.Error) as exc:
        raise HTTPException(status_code=422,detail='Imagen inválida') from exc
    raise HTTPException(status_code=413,detail='Imagen demasiado grande')


def put_post_image(media_id:UUID,data:bytes)->str:
    if len(data)>MAX_OUTPUT or not data.startswith(b'RIFF') or data[8:12]!=b'WEBP':
        raise ValueError('Invalid image encoding')
    key=media_key(media_id)
    _put_bytes(key,data,'image/webp')
    return key


def get_post_image(key:str)->bytes:
    if not key.startswith(ROOT) or not key.endswith('.webp'):
        raise ValueError('Invalid image reference')
    raw=_get_bytes(key,MAX_OUTPUT)
    if not raw.startswith(b'RIFF') or raw[8:12]!=b'WEBP':
        raise ValueError('Corrupt image')
    return raw


def delete_post_image(key:str)->None:
    if not key.startswith(ROOT) or not key.endswith('.webp'):
        raise ValueError('Invalid image reference')
    settings=_s3_settings()
    if settings is None:
        (LOCAL_STORE/key).unlink(missing_ok=True)
    else:
        endpoint,bucket,region,access,secret=settings
        _client(endpoint,access,secret,region).delete_object(Bucket=bucket,Key=key)
