"""Exercise the actual PostgreSQL trigger, transaction and private routing.

Executed by the dedicated postgres CI job; ordinary SQLite pytest skips it.
"""
import json
import os
from uuid import uuid4

import psycopg
import pytest

DATABASE_URL = os.getenv("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg://")),
    reason="PostgreSQL LISTEN/NOTIFY integration test",
)


def test_postgres_events_only_after_commit_and_recipient_scoped():
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://", 1)
    alice_id = uuid4()
    bob_id = uuid4()
    post_id = uuid4()
    prefix = uuid4().hex[:12]
    with psycopg.connect(dsn, autocommit=True) as listener, \
         psycopg.connect(dsn, autocommit=True) as writer:
        listener.execute("LISTEN astrogram_events")
        with writer.transaction():
            for person_id, name in ((alice_id, "a" + prefix), (bob_id, "b" + prefix)):
                writer.execute(
                    """INSERT INTO users (id, username, display_name, email, password_hash)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (person_id, name, name, name + "@example.test", "hash-placeholder"),
                )
            writer.execute(
                """INSERT INTO posts (id, author_id, caption, visibility)
                   VALUES (%s, %s, %s, 'public')""",
                (post_id, alice_id, "Visible astronomy post"),
            )
        initial = [json.loads(item.payload) for item in listener.notifies(timeout=0.3)]
        assert any(x.get("kind") == "feed" and x.get("post_id") == str(post_id)
                   for x in initial)

        # A transaction that rolls back cannot generate a ghost feed update.
        with pytest.raises(RuntimeError):
            with writer.transaction():
                writer.execute("UPDATE posts SET caption='uncommitted' WHERE id=%s",
                               (post_id,))
                raise RuntimeError("force rollback")
        assert list(listener.notifies(timeout=0.2)) == []

        with writer.transaction():
            writer.execute(
                """INSERT INTO notifications
                   (id, recipient_id, actor_id, kind, event_key, post_id)
                   VALUES (%s, %s, %s, 'like', %s, %s)""",
                (uuid4(), alice_id, bob_id, "like:" + uuid4().hex, post_id),
            )
        events = [json.loads(item.payload) for item in listener.notifies(timeout=0.3)]
        assert any(x.get("kind") == "notifications"
                   and x.get("scope") == "user"
                   and x.get("user_id") == str(alice_id)
                   and "caption" not in x and "email" not in x for x in events)

        # Hidden birth dates must not create a public-profile signal.
        with writer.transaction():
            writer.execute(
                "UPDATE users SET birth_date=DATE '2003-05-21' WHERE id=%s",
                (alice_id,),
            )
        changes = [json.loads(item.payload) for item in listener.notifies(timeout=0.3)]
        assert any(x.get("kind") == "profile" and x.get("scope") == "user"
                   and x.get("user_id") == str(alice_id) for x in changes)
        assert not any(x.get("kind") == "profile" and x.get("scope") != "user"
                       for x in changes)
