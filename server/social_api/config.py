"""Configuration for local development and Railway.

Production requires DATABASE_URL: it never silently creates a local SQLite file.
"""
import os
from dotenv import load_dotenv
from functools import lru_cache
from pydantic import BaseModel


load_dotenv()  # Local .env; Railway variables override by default.


class Settings(BaseModel):
    app_name: str
    app_env: str
    database_url: str
    cors_origins: list[str]


@lru_cache
def get_settings() -> Settings:
    app_env = os.environ.get('APP_ENV', 'development').lower()
    url = os.environ.get('DATABASE_URL')
    if not url:
        if app_env == 'production':
            raise RuntimeError('DATABASE_URL is required in production')
        url = 'sqlite+pysqlite:///./spherex_dev.sqlite3'
    if url.startswith('postgres://'):
        url = 'postgresql+psycopg://' + url[len('postgres://'):]
    elif url.startswith('postgresql://'):
        url = 'postgresql+psycopg://' + url[len('postgresql://'):]
    cors_raw = os.environ.get('CORS_ORIGINS', '')
    origins = [s.strip() for s in cors_raw.split(',') if s.strip()]
    return Settings(
        app_name=os.environ.get('APP_NAME','SPHEREx Social API'),
        app_env=app_env,
        database_url=url,
        cors_origins=origins,
    )
