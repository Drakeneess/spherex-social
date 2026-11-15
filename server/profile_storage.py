"""Private S3 media for public profile visuals; bounded WebP without metadata.

Avatar: 256 x 256, <=96 KiB. Cover: 1280 x 400, <=350 KiB.
The browser accesses image bytes through the API, never S3 keys.
"""
from __future__ import annotations

import base64
import io
from uuid import UUID

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from sky_storage import _put_bytes, _get_bytes, _s3_settings, _client, LOCAL_STORE

MAX_RAW_BYTES=3*1024*1024
MAX_PIXELS=16_000_000
KINDS={
    'avatar':((256,256),96*1024),
    'cover':((1280,400),350*1024),
}
PREFIXES=('data:image/jpeg;base64,','data:image/png;base64,','data:image/webp;base64,')
ROOT='social/profile/v1/'


def image_key(user_id:UUID,version:UUID,kind:str)->str:
    if kind not in KINDS: raise ValueError('Tipo de imagen no permitido')
    return f'{ROOT}{user_id}/{version}/{kind}.webp'


def decode_profile_image(data_url:str,kind:str)->bytes:
    if kind not in KINDS:raise ValueError('Tipo de imagen no permitido')
    prefix=next((p for p in PREFIXES if data_url.startswith(p)),None)
    if prefix is None:
        raise HTTPException(status_code=422,detail='Solo se admiten imágenes JPEG, PNG y WebP')
    encoded=data_url[len(prefix):]
    if len(encoded)>MAX_RAW_BYTES*4//3+8:
        raise HTTPException(status_code=413,detail='La imagen supera 3 MiB')
    size,limit=KINDS[kind]
    try:
        raw=base64.b64decode(encoded,validate=True)
        if not raw or len(raw)>MAX_RAW_BYTES:
            raise ValueError('oversized')
        with Image.open(io.BytesIO(raw)) as original:
            if original.format not in ('JPEG','PNG','WEBP'):
                raise ValueError('unsupported')
            if original.width<1 or original.height<1 or original.width*original.height>MAX_PIXELS:
                raise ValueError('dimensions')
            photo=ImageOps.exif_transpose(original)
            photo=photo.convert('RGB')
            # The editor uses the same centered object-fit:cover crop.
            image=ImageOps.fit(photo,size,Image.Resampling.LANCZOS,centering=(.5,.5))
            for quality in (86,80,74,68,62,58):
                buffer=io.BytesIO()
                image.save(buffer,format='WEBP',quality=quality,method=4)
                candidate=buffer.getvalue()
                if len(candidate)<=limit:
                    return candidate
    except (ValueError,OSError,UnidentifiedImageError,
            Image.DecompressionBombError,base64.binascii.Error) as exc:
        raise HTTPException(status_code=422,detail='Imagen inválida') from exc
    raise HTTPException(status_code=413,detail='Imagen demasiado compleja para el límite de calidad')


def put_profile_image(user_id:UUID,version:UUID,kind:str,data:bytes)->None:
    _,limit=KINDS[kind]
    if len(data)>limit or data[:4]!=b'RIFF' or data[8:12]!=b'WEBP':
        raise ValueError('Imagen no optimizada')
    _put_bytes(image_key(user_id,version,kind),data,'image/webp')


def get_profile_image(user_id:UUID,version:UUID,kind:str)->bytes:
    _,limit=KINDS[kind]
    data=_get_bytes(image_key(user_id,version,kind),limit)
    if data[:4]!=b'RIFF' or data[8:12]!=b'WEBP':
        raise ValueError('Imagen corrupta')
    return data


def delete_profile_image(user_id:UUID,version:UUID,kind:str)->None:
    key=image_key(user_id,version,kind)
    settings=_s3_settings()
    if settings is None:
        (LOCAL_STORE/key).unlink(missing_ok=True)
    else:
        endpoint,bucket,region,access,secret=settings
        _client(endpoint,access,secret,region).delete_object(Bucket=bucket,Key=key)
