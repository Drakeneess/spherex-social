"""Standalone social API for fast tests and future service extraction."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import router
from .auth import router as auth_router
from .config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version='0.3.0')
    app.include_router(router)
    app.include_router(auth_router)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                           allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH'], allow_headers=['Authorization', 'Content-Type'])
    return app


app = create_app()
