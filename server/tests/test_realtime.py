"""Security and backpressure tests for live social invalidations."""
from social_api.realtime import EventHub, visible_event


def test_private_events_only_reach_recipient():
    payload = {"kind": "notifications", "scope": "user",
               "user_id": "alice", "post_id": "secret-post"}
    assert visible_event(payload, None) is None
    assert visible_event(payload, "bob") is None
    assert visible_event(payload, "alice") == {
        "kind": "notifications", "post_id": "secret-post",
    }


def test_public_events_are_metadata_only():
    payload = {"kind": "feed", "scope": "public",
               "post_id": "public-id", "email": "do-not-send@example.com",
               "caption": "private text", "user_id": "alice"}
    assert visible_event(payload, None) == {
        "kind": "feed", "post_id": "public-id",
    }


def test_unknown_scopes_and_kinds_never_pass():
    assert visible_event({"kind": "notifications", "scope": "internal"}, "alice") is None
    assert visible_event({"kind": "admin", "scope": "public"}, None) is None


def test_subscriber_overflow_becomes_full_resync():
    hub = EventHub()
    subscriber = hub.subscribe()
    for index in range(128):
        hub.broadcast({"kind": "interaction", "post_id": str(index)})
    assert subscriber.qsize() == 128
    hub.broadcast({"kind": "feed", "post_id": "129"})
    assert subscriber.qsize() == 1
    assert subscriber.get_nowait() == {"kind": "resync"}
    hub.unsubscribe(subscriber)
    assert not hub.subscribers


def test_sky_job_signal_requires_explicit_job_subscription():
    event = {'kind': 'sky_job', 'job_id': 'job-a'}
    assert visible_event(event, None) is None
    assert visible_event(event, 'alice', 'job-b') is None
    assert visible_event(event, None, 'job-a') == event
