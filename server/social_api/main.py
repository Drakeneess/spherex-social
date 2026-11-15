"""Standalone social API for fast tests and future service extraction."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import router
from .auth import router as auth_router
from .interactions import router as interactions_router
from .notifications import router as notifications_router
from .observations import router as observations_router
from .realtime import router as realtime_router, event_listener
from .posts import router as posts_router
from .config import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with event_listener():
        yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version='0.6.0', lifespan=lifespan)
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(posts_router)
    app.include_router(interactions_router)
    app.include_router(notifications_router)
    app.include_router(observations_router)
    app.include_router(realtime_router)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                           allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])
    return app


app = create_app()
