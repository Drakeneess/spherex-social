"""Hashtag recognition and safe outbound URL validation."""
from __future__ import annotations
import re
from urllib.parse import urlsplit

TAG_RE=re.compile(r"(?<![\w#])#([^\W_][\w]{1,29})",re.UNICODE)
EXACT_RE=re.compile(r"^[^\W_][\w]{1,29}$",re.UNICODE)


def extract_hashtags(caption:str)->list[str]:
    return sorted({tag for m in TAG_RE.finditer(caption) if len(tag:=m.group(1).casefold())<=30})


def normalize_tag(value:str)->str|None:
    tag=value.lstrip('#').casefold()
    return tag if len(tag)<=30 and EXACT_RE.fullmatch(tag) else None


def validate_link(value:str|None)->str|None:
    if value is None: return None
    url=value.strip()
    if not url:return None
    parsed=urlsplit(url)
    if parsed.scheme.lower() not in ('http','https') or not parsed.hostname:
        raise ValueError('El enlace debe comenzar con http:// o https://')
    if parsed.username or parsed.password or any(c.isspace() for c in url):
        raise ValueError('Enlace inválido')
    return url
