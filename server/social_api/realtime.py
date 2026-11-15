"""Transactional realtime invalidations over PostgreSQL LISTEN/NOTIFY and SSE.

Payloads contain identifiers only, never private records or notification text.
Each SSE client receives a filtered subset of a shared, per-worker listener.
The REST API remains the source of truth, including after reconnects.
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager, suppress
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from .config import get_settings
from .models import User
from .posts import optional_user

logger = logging.getLogger("astrogram.realtime")
router = APIRouter(prefix="/v1", tags=["realtime"])
CHANNEL = "astrogram_events"
ALLOWED_KINDS = {
    "feed", "interaction", "comments", "profile", "profile_stats",
    "profile_posts", "bookmarks", "notifications", "sky_job", "resync",
}


class EventHub:
    def __init__(self) -> None:
        self.subscribers: set[asyncio.Queue[dict]] = set()

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=128)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self.subscribers.discard(queue)

    def broadcast(self, payload: dict) -> None:
        if payload.get("kind") not in ALLOWED_KINDS:
            return
        for queue in tuple(self.subscribers):
            if queue.full():
                # Losing one invalidation must lead to a REST resync, not stale UI.
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"kind": "resync"})
            else:
                queue.put_nowait(payload)


hub = EventHub()


def visible_event(payload: dict, user_id: str | None) -> dict | None:
    """Never return the routing user ID (nor anyone else's private events)."""
    if payload.get("kind") not in ALLOWED_KINDS:
        return None
    if payload.get("scope") == "user":
        if not user_id or payload.get("user_id") != user_id:
            return None
    elif payload.get("scope") not in (None, "public"):
        return None
    return {key: payload[key] for key in ("kind", "post_id", "username", "job_id")
            if isinstance(payload.get(key), str)}


async def _listen_database() -> None:
    from sqlalchemy.engine import make_url
    url = get_settings().database_url
    if not url.startswith("postgresql"):
        logger.info("Realtime PostgreSQL events are disabled for non-Postgres development DB")
        return
    dsn = make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)
    delay = 1
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(
                dsn, autocommit=True, connect_timeout=10
            ) as connection:
                await connection.execute("LISTEN " + CHANNEL)
                hub.broadcast({"kind": "resync"})
                delay = 1
                async for notification in connection.notifies():
                    try:
                        data = json.loads(notification.payload)
                        if isinstance(data, dict):
                            hub.broadcast(data)
                    except (ValueError, TypeError):
                        logger.warning("Rejected malformed realtime notification")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Realtime listener disconnected; retrying")
            hub.broadcast({"kind": "resync"})
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


@asynccontextmanager
async def event_listener():
    task = asyncio.create_task(_listen_database())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@router.get("/events")
async def stream_events(
    request: Request,
    viewer: Annotated[User | None, Depends(optional_user)],
):
    user_id = str(viewer.id) if viewer is not None else None

    async def stream():
        queue = hub.subscribe()
        try:
            # A fresh connection always reconciles potentially missed events.
            yield "retry: 2000\nevent: ready\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                outgoing = visible_event(payload, user_id)
                if outgoing:
                    yield "event: change\ndata: " + json.dumps(outgoing, separators=(",", ":")) + "\n\n"
        finally:
            hub.unsubscribe(queue)

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store, no-transform",
                 "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
