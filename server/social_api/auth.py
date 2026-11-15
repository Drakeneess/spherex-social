"""Authentication and profile endpoints for the SPHEREx social platform.

Access JWTs remain short-lived. An HttpOnly, revocable device session in
PostgreSQL transparently renews them, so a 30-minute token expiry does not log
users out. Only a hash of the opaque cookie secret is stored at rest.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuthSession, User

router = APIRouter(prefix='/v1', tags=['authentication'])
bearer = HTTPBearer(auto_error=False, scheme_name='BearerAuth')
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
# Prevent a fast no-such-account path from giving away email existence via timing.
unknown_account_hash = password_hasher.hash('not-an-account-password')
USERNAME_PATTERN = re.compile(r'^[a-z][a-z0-9_]{2,31}$')
RESERVED_USERNAMES = {'me', 'admin', 'api', 'support', 'auth'}
REFRESH_COOKIE = "astrogram_refresh"
REFRESH_SECONDS = 90 * 24 * 60 * 60
REFRESH_COOKIE_PATH = "/v1/auth"


class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=3, max_length=32)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: SecretStr = Field(min_length=10, max_length=128)

    @field_validator('username')
    @classmethod
    def normalize_username(cls, username: str) -> str:
        username = username.strip().lower()
        if not USERNAME_PATTERN.fullmatch(username) or username in RESERVED_USERNAMES:
            raise ValueError('Username must be 3–32 characters, start with a letter and use only a-z, 0-9 or _.')
        return username

    @field_validator('display_name')
    @classmethod
    def trim_display_name(cls, name: str) -> str:
        name = name.strip()
        if not name:
            raise ValueError('Display name is required')
        return name


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr
    password: SecretStr


class PublicProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    bio: str | None
    created_at: datetime


class PrivateProfile(PublicProfile):
    email: EmailStr


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    bio: str | None = Field(default=None, max_length=500)

    @field_validator('display_name')
    @classmethod
    def validate_display_name(cls, name: str | None) -> str | None:
        if name is None:
            raise ValueError('Display name cannot be null')
        name = name.strip()
        if not name:
            raise ValueError('Display name cannot be empty')
        return name

    @field_validator('bio')
    @classmethod
    def clean_bio(cls, bio: str | None) -> str | None:
        return bio.strip() if bio is not None else None


class AccessToken(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    expires_in: int


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Invalid or expired authentication credentials',
        headers={'WWW-Authenticate': 'Bearer'},
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _create_access_token(user: User) -> AccessToken:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ttl = settings.jwt_access_minutes * 60
    claims = {
        'sub': str(user.id),
        'iss': settings.jwt_issuer,
        'aud': settings.jwt_audience,
        'iat': now,
        'nbf': now,
        'exp': now + timedelta(seconds=ttl),
        'jti': str(uuid.uuid4()),
    }
    token = jwt.encode(claims, settings.jwt_secret, algorithm='HS256')
    return AccessToken(access_token=token, expires_in=ttl)


def _refresh_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def _set_refresh_cookie(response: Response, secret: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE, secret, max_age=REFRESH_SECONDS,
        path=REFRESH_COOKIE_PATH, httponly=True,
        secure=get_settings().app_env == "production", samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE, path=REFRESH_COOKIE_PATH,
        secure=get_settings().app_env == "production", httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise _unauthorized()
    settings = get_settings()
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=['HS256'],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={'require': ['sub', 'exp', 'iat', 'iss', 'aud', 'nbf', 'jti']},
        )
        user_id = uuid.UUID(claims['sub'])
    except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
        raise _unauthorized() from exc
    user = db.get(User, user_id)
    if user is None:
        raise _unauthorized()
    return user


@router.post('/auth/register', response_model=PrivateProfile, status_code=status.HTTP_201_CREATED)
def register(body: RegistrationRequest, db: Annotated[Session, Depends(get_db)]):
    username = body.username
    email = _normalize_email(str(body.email))
    existing = db.scalar(select(User.id).where(or_(User.username == username, func.lower(User.email) == email)))
    if existing is not None:
        raise HTTPException(status_code=409, detail='Username or email already registered')
    user = User(
        username=username,
        display_name=body.display_name,
        email=email,
        password_hash=password_hasher.hash(body.password.get_secret_value()),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail='Username or email already registered') from exc
    db.refresh(user)
    return user


@router.post('/auth/login', response_model=AccessToken)
def login(body: LoginRequest, response: Response,
          db: Annotated[Session, Depends(get_db)]):
    email = _normalize_email(str(body.email))
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    hash_to_verify = user.password_hash if user else unknown_account_hash
    try:
        valid = password_hasher.verify(hash_to_verify, body.password.get_secret_value())
    except (VerificationError, InvalidHashError):
        valid = False
    if user is None or not valid:
        raise _unauthorized()
    secret = secrets.token_urlsafe(32)
    db.add(AuthSession(
        user_id=user.id,
        secret_hash=_refresh_hash(secret),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=REFRESH_SECONDS),
    ))
    db.commit()
    _set_refresh_cookie(response, secret)
    return _create_access_token(user)


@router.post('/auth/refresh', response_model=AccessToken)
def refresh_access(request: Request, response: Response,
                   db: Annotated[Session, Depends(get_db)]):
    """Renew a short JWT from a revocable, 90-day rolling HttpOnly cookie."""
    secret = request.cookies.get(REFRESH_COOKIE, "")
    if not secret or len(secret) > 128 or not secret.isascii():
        raise _unauthorized()
    session = db.scalar(select(AuthSession).where(
        AuthSession.secret_hash == _refresh_hash(secret),
    ))
    now = datetime.now(timezone.utc)
    if session is None:
        raise _unauthorized()
    expiry = session.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= now:
        db.delete(session)
        db.commit()
        raise _unauthorized()
    user = db.get(User, session.user_id)
    if user is None:
        db.delete(session)
        db.commit()
        raise _unauthorized()
    session.last_used_at = now
    session.expires_at = now + timedelta(seconds=REFRESH_SECONDS)
    db.commit()
    _set_refresh_cookie(response, secret)
    return _create_access_token(user)


@router.post('/auth/logout', status_code=204)
def revoke_session(request: Request, response: Response,
                   db: Annotated[Session, Depends(get_db)]):
    """Invalidate just this device, without affecting other logged-in devices."""
    secret = request.cookies.get(REFRESH_COOKIE, "")
    if secret and len(secret) <= 128 and secret.isascii():
        db.execute(delete(AuthSession).where(
            AuthSession.secret_hash == _refresh_hash(secret),
        ))
        db.commit()
    _clear_refresh_cookie(response)
    return None


@router.get('/users/me', response_model=PrivateProfile, tags=['profiles'])
def get_me(user: Annotated[User, Depends(current_user)]):
    return user


@router.patch('/users/me', response_model=PrivateProfile, tags=['profiles'])
def patch_me(
    body: ProfilePatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    for key in body.model_fields_set:
        setattr(user, key, getattr(body, key))
    db.commit()
    db.refresh(user)
    return user


@router.get('/users/{username}', response_model=PublicProfile, tags=['profiles'])
def get_public_profile(username: str, db: Annotated[Session, Depends(get_db)]):
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None:
        raise HTTPException(status_code=404, detail='User not found')
    return user
