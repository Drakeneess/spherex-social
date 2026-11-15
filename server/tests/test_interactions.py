"""Sprint 3 integration tests: visibility, idempotency, and ownership."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from social_api.auth import _create_access_token
from social_api.db import Base, get_db
from social_api.main import create_app
from social_api.models import AuthSession, User


@pytest.fixture
def env():
    engine = create_engine(
        'sqlite+pysqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, 'connect')
    def enforce_foreign_keys(dbapi_connection, _):
        dbapi_connection.execute('PRAGMA foreign_keys=ON')

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        alpha = User(username='alpha', display_name='Alpha', email='alpha@example.invalid',
                     password_hash='test-only')
        beta = User(username='beta', display_name='Beta', email='beta@example.invalid',
                    password_hash='test-only')
        gamma = User(username='gamma', display_name='Gamma', email='gamma@example.invalid',
                     password_hash='test-only')
        db.add_all([alpha, beta, gamma])
        db.commit()
        for user in (alpha, beta, gamma):
            db.refresh(user)
        headers = {}
        for user in (alpha, beta, gamma):
            device = AuthSession(
                user_id=user.id, secret_hash=uuid.uuid4().hex + uuid.uuid4().hex,
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
            db.add(device)
            db.flush()
            headers[user.username] = {
                'Authorization': f'Bearer {_create_access_token(user, device).access_token}',
            }
        db.commit()

    app = create_app()

    def get_test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = get_test_db
    try:
        with TestClient(app) as client:
            yield client, headers
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def new_post(client, headers, visibility='public', caption='Changing sky'):
    result = client.post('/v1/posts', headers=headers['alpha'], json={
        'caption': caption, 'visibility': visibility,
    })
    assert result.status_code == 201, result.text
    return result.json()['id']


def test_likes_idempotent_and_counts_on_feed_and_detail(env):
    client, headers = env
    post_id = new_post(client, headers)
    like_url = f'/v1/posts/{post_id}/like'
    assert client.post(like_url).status_code == 401
    assert client.post(like_url, headers=headers['beta']).status_code == 204
    assert client.post(like_url, headers=headers['beta']).status_code == 204
    assert client.post(like_url, headers=headers['gamma']).status_code == 204
    item = client.get(f'/v1/posts/{post_id}').json()
    assert item['likes_count'] == 2 and item['comments_count'] == 0
    assert client.get('/v1/feed').json()[0]['likes_count'] == 2
    assert client.get('/v1/users/alpha/posts').json()[0]['likes_count'] == 2
    assert client.delete(like_url, headers=headers['beta']).status_code == 204
    assert client.delete(like_url, headers=headers['beta']).status_code == 204
    assert client.get(f'/v1/posts/{post_id}').json()['likes_count'] == 1


def test_bookmarks_are_private_and_idempotent(env):
    client, headers = env
    public = new_post(client, headers, 'public', 'public')
    unlisted = new_post(client, headers, 'unlisted', 'unlisted')
    secret = new_post(client, headers, 'private', 'secret')
    url = f'/v1/posts/{public}/bookmark'
    assert client.post(url).status_code == 401
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{unlisted}/bookmark', headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{secret}/bookmark', headers=headers['beta']).status_code == 404
    assert client.get('/v1/users/me/bookmarks').status_code == 401
    saved_beta = client.get('/v1/users/me/bookmarks', headers=headers['beta']).json()
    assert {p['id'] for p in saved_beta} == {public, unlisted}
    assert client.get('/v1/users/me/bookmarks', headers=headers['alpha']).json() == []
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert [p['id'] for p in client.get('/v1/users/me/bookmarks', headers=headers['beta']).json()] == [unlisted]
    # If a formerly public post turns private, other users cannot see it in saved items.
    assert client.patch(f'/v1/posts/{unlisted}', headers=headers['alpha'],
                        json={'visibility': 'private'}).status_code == 200
    assert client.get('/v1/users/me/bookmarks', headers=headers['beta']).json() == []


def test_comments_replies_validation_and_counters(env):
    client, headers = env
    post_id = new_post(client, headers)
    other_post_id = new_post(client, headers, caption='Other post')
    url = f'/v1/posts/{post_id}/comments'
    assert client.post(url, json={'body': 'Unverified'}).status_code == 401
    assert client.post(url, headers=headers['beta'], json={'body': '  '}).status_code == 422
    assert client.post(url, headers=headers['beta'], json={'body': 'x' * 2001}).status_code == 422
    assert client.post(url, headers=headers['beta'], json={'body': 'Hello', 'unknown': 2}).status_code == 422
    root = client.post(url, headers=headers['beta'], json={'body': '  I see a change  '})
    assert root.status_code == 201, root.text
    root_id = root.json()['id']
    assert root.json()['username'] == 'beta'
    assert root.json()['body'] == 'I see a change'
    reply = client.post(url, headers=headers['gamma'], json={
        'body': 'I can confirm', 'parent_id': root_id,
    })
    assert reply.status_code == 201
    assert reply.json()['parent_id'] == root_id
    invalid_reply = client.post(f'/v1/posts/{other_post_id}/comments', headers=headers['gamma'],
                                json={'body': 'wrong tree', 'parent_id': root_id})
    assert invalid_reply.status_code == 404
    read = client.get(url)
    assert read.status_code == 200
    assert [item['body'] for item in read.json()] == ['I see a change', 'I can confirm']
    assert client.get(url + '?limit=1').json()[0]['id'] == root_id
    assert client.get(url + '?limit=0').status_code == 422
    assert client.get(f'/v1/posts/{post_id}').json()['comments_count'] == 2
    assert client.get('/v1/feed').json()[0 if client.get('/v1/feed').json()[0]['id'] == post_id else 1]['comments_count'] == 2


def test_comment_delete_permissions_and_cascade(env):
    client, headers = env
    post_id = new_post(client, headers)
    url = f'/v1/posts/{post_id}/comments'
    root_id = client.post(url, headers=headers['beta'], json={'body': 'Root'}).json()['id']
    reply_id = client.post(url, headers=headers['gamma'],
                           json={'body': 'Reply', 'parent_id': root_id}).json()['id']
    deletion = f'{url}/{root_id}'
    assert client.delete(deletion).status_code == 401
    assert client.delete(deletion, headers=headers['gamma']).status_code == 403
    assert client.delete(f'{url}/{uuid.uuid4()}', headers=headers['alpha']).status_code == 404
    assert client.delete(deletion, headers=headers['alpha']).status_code == 204
    assert client.get(url).json() == []
    assert client.get(f'/v1/posts/{post_id}').json()['comments_count'] == 0
    assert client.delete(f'{url}/{reply_id}', headers=headers['gamma']).status_code == 404


def test_follows_counts_and_self_follow_block(env):
    client, headers = env
    url = '/v1/users/alpha/follow'
    assert client.post(url).status_code == 401
    assert client.post(url, headers=headers['alpha']).status_code == 400
    assert client.post('/v1/users/absent/follow', headers=headers['beta']).status_code == 404
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['gamma']).status_code == 204
    stats = client.get('/v1/users/alpha/stats').json()
    assert stats == {'username': 'alpha', 'followers_count': 2,
                     'following_count': 0, 'is_following': False}
    assert client.get('/v1/users/alpha/stats', headers=headers['beta']).json()['is_following']
    assert client.get('/v1/users/beta/stats').json()['following_count'] == 1
    assert client.get('/v1/users/absent/stats').status_code == 404
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.get('/v1/users/alpha/stats').json()['followers_count'] == 1
    assert not client.get('/v1/users/alpha/stats', headers=headers['beta']).json()['is_following']


def test_private_posts_protect_interactions(env):
    client, headers = env
    private = new_post(client, headers, visibility='private')
    unlisted = new_post(client, headers, visibility='unlisted')
    for kind in ('like', 'bookmark'):
        assert client.post(f'/v1/posts/{private}/{kind}', headers=headers['beta']).status_code == 404
        assert client.post(f'/v1/posts/{private}/{kind}', headers=headers['alpha']).status_code == 204
        assert client.post(f'/v1/posts/{unlisted}/{kind}', headers=headers['beta']).status_code == 204
    assert client.get(f'/v1/posts/{private}/comments').status_code == 404
    assert client.post(f'/v1/posts/{private}/comments', headers=headers['beta'],
                       json={'body': 'Nope'}).status_code == 404
    assert client.get(f'/v1/posts/{private}/comments', headers=headers['alpha']).status_code == 200
    assert client.post(f'/v1/posts/{unlisted}/comments', headers=headers['beta'],
                       json={'body': 'By direct link'}).status_code == 201
    assert client.get(f'/v1/posts/{unlisted}/comments').json()[0]['body'] == 'By direct link'
    assert client.get(f'/v1/posts/{unlisted}').json()['likes_count'] == 1
    assert client.get('/v1/feed').json() == []
    assert client.get('/v1/users/me/bookmarks', headers=headers['alpha']).json()[0]['id'] == private


def test_combined_app_has_new_routes():
    from app import app
    paths = app.openapi()['paths']
    for endpoint in (
        '/v1/posts/{post_id}/like', '/v1/posts/{post_id}/bookmark',
        '/v1/posts/{post_id}/comments', '/v1/posts/{post_id}/comments/{comment_id}',
        '/v1/users/{username}/follow', '/v1/users/{username}/stats',
        '/v1/users/me/bookmarks', '/v1/posts/{post_id}/repost',
    ):
        assert endpoint in paths

def test_public_reposts_appear_on_profile_with_original_attribution(env):
    client, headers = env
    original = new_post(client, headers, 'public', 'Real SPHEREx observation')
    url = f'/v1/posts/{original}/repost'
    assert client.post(url).status_code == 401
    assert client.post(url, headers=headers['alpha']).status_code == 400
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204

    # No duplicate posts in the public feed: only the original receives interactions.
    feed = client.get('/v1/feed').json()
    assert [post['id'] for post in feed] == [original]
    assert feed[0]['reposts_count'] == 1 and feed[0]['reposted_by_me'] is False
    assert client.get('/v1/feed', headers=headers['beta']).json()[0]['reposted_by_me'] is True

    shared = client.get('/v1/users/beta/posts', headers=headers['beta']).json()
    assert len(shared) == 1
    assert shared[0]['id'] == original
    assert shared[0]['username'] == 'alpha'
    assert shared[0]['reposted_by'] == 'beta'
    assert shared[0]['reposted_at'] is not None
    assert shared[0]['reposted_by_me'] is True
    assert client.get('/v1/users/beta/posts').json()[0]['reposted_by_me'] is False
    assert client.get('/v1/users/alpha/posts').json()[0]['reposted_by'] is None

    assert client.post(f'/v1/posts/{original}/like', headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{original}/comments', headers=headers['beta'],
                       json={'body': 'Interesting'}).status_code == 201
    shared = client.get('/v1/users/beta/posts').json()[0]
    assert shared['likes_count'] == 1 and shared['comments_count'] == 1

    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.get('/v1/users/beta/posts').json() == []
    assert client.get(f'/v1/posts/{original}').json()['reposts_count'] == 0


def test_repost_privacy_and_deletion(env):
    client, headers = env
    public = new_post(client, headers, 'public', 'Public')
    unlisted = new_post(client, headers, 'unlisted', 'Unlisted')
    private = new_post(client, headers, 'private', 'Private')
    for post_id in (unlisted, private, str(uuid.uuid4())):
        assert client.post(f'/v1/posts/{post_id}/repost', headers=headers['beta']).status_code == 404

    url = f'/v1/posts/{public}/repost'
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert [p['id'] for p in client.get('/v1/users/beta/posts').json()] == [public]
    assert client.patch(f'/v1/posts/{public}', headers=headers['alpha'],
                        json={'visibility': 'private'}).status_code == 200
    assert client.get('/v1/users/beta/posts').json() == []
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert client.patch(f'/v1/posts/{public}', headers=headers['alpha'],
                        json={'visibility': 'public'}).status_code == 200
    assert client.get('/v1/users/beta/posts').json() == []
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.delete(f'/v1/posts/{public}', headers=headers['alpha']).status_code == 204
    assert client.get('/v1/users/beta/posts').json() == []


def test_repost_profile_pagination_combines_authored_and_shared(env):
    client, headers = env
    authored = new_post(client, headers, 'public', 'Alpha post')
    mine = client.post('/v1/posts', headers=headers['beta'],
                       json={'caption': 'Beta post'}).json()['id']
    assert client.post(f'/v1/posts/{authored}/repost', headers=headers['beta']).status_code == 204
    posts = client.get('/v1/users/beta/posts', headers=headers['beta']).json()
    assert {p['id'] for p in posts} == {authored, mine}
    assert sum(1 for p in posts if p['reposted_by']) == 1
    assert len(client.get('/v1/users/beta/posts?limit=1').json()) == 1
    assert len(client.get('/v1/users/beta/posts?limit=1&offset=1').json()) == 1


def test_bookmark_status_is_loaded_from_database_across_all_post_views(env):
    client, headers = env
    public = new_post(client, headers, 'public', 'Bookmark across views')
    own_secret = client.post('/v1/posts', headers=headers['beta'], json={
        'caption': 'My private note', 'visibility': 'private',
    }).json()['id']

    url = f'/v1/posts/{public}/bookmark'
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(f'/v1/posts/{own_secret}/bookmark', headers=headers['beta']).status_code == 204

    def one(path, auth=None, post_id=public):
        response = client.get(path, headers=headers[auth] if auth else None)
        assert response.status_code == 200
        posts = response.json()
        if isinstance(posts, list):
            return next(item for item in posts if item['id'] == post_id)
        return posts

    for route in (
        '/v1/feed',
        '/v1/users/alpha/posts',
        f'/v1/posts/{public}',
    ):
        assert one(route)['bookmarked_by_me'] is False
        assert one(route, 'beta')['bookmarked_by_me'] is True
        assert one(route, 'alpha')['bookmarked_by_me'] is False

    assert one('/v1/users/me/bookmarks', 'beta')['bookmarked_by_me'] is True
    assert one('/v1/users/beta/posts', 'beta', own_secret)['bookmarked_by_me'] is True
    assert one(f'/v1/posts/{own_secret}', 'beta')['bookmarked_by_me'] is True
    assert client.get(f'/v1/posts/{own_secret}', headers=headers['alpha']).status_code == 404

    # A fresh request reflects the persisted state after removal.
    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert one('/v1/feed', 'beta')['bookmarked_by_me'] is False
    assert one(f'/v1/posts/{public}', 'beta')['bookmarked_by_me'] is False
    saved = client.get('/v1/users/me/bookmarks', headers=headers['beta']).json()
    assert {item['id'] for item in saved} == {own_secret}
    assert saved[0]['bookmarked_by_me'] is True


# -----------------------------------------------------------
# Persistent social notification integration tests
# -----------------------------------------------------------

def inbox(client, headers, username):
    response = client.get('/v1/users/me/notifications', headers=headers[username])
    assert response.status_code == 200, response.text
    return response.json()


def unread(client, headers, username):
    response = client.get('/v1/users/me/notifications/count', headers=headers[username])
    assert response.status_code == 200, response.text
    return response.json()['unread']


def test_notifications_only_from_new_real_actions_not_self_or_retries(env):
    client, headers = env
    post_id = new_post(client, headers)
    url = f'/v1/posts/{post_id}/like'
    assert client.get('/v1/users/me/notifications').status_code == 401
    assert client.get('/v1/users/me/notifications/count').status_code == 401
    assert client.post(url, headers=headers['alpha']).status_code == 204
    assert unread(client, headers, 'alpha') == 0

    assert client.post(url, headers=headers['beta']).status_code == 204
    assert client.post(url, headers=headers['beta']).status_code == 204
    notifications = inbox(client, headers, 'alpha')
    assert len(notifications) == 1
    assert notifications[0]['kind'] == 'like'
    assert notifications[0]['actor_username'] == 'beta'
    assert notifications[0]['post_id'] == post_id
    assert notifications[0]['post_author_username'] == 'alpha'
    assert notifications[0]['read_at'] is None
    assert unread(client, headers, 'alpha') == 1
    assert inbox(client, headers, 'beta') == []

    assert client.delete(url, headers=headers['beta']).status_code == 204
    assert inbox(client, headers, 'alpha') == []
    assert unread(client, headers, 'alpha') == 0
    assert client.post(url, headers=headers['beta']).status_code == 204
    assert len(inbox(client, headers, 'alpha')) == 1
    # Another actor causes a distinct event.
    assert client.post(url, headers=headers['gamma']).status_code == 204
    assert unread(client, headers, 'alpha') == 2


def test_reposts_and_follows_create_and_undo_events_without_duplicates(env):
    client, headers = env
    post_id = new_post(client, headers)
    repost=f'/v1/posts/{post_id}/repost'
    follow='/v1/users/alpha/follow'
    assert client.post(repost, headers=headers['beta']).status_code == 204
    assert client.post(repost, headers=headers['beta']).status_code == 204
    assert client.post(follow, headers=headers['beta']).status_code == 204
    assert client.post(follow, headers=headers['beta']).status_code == 204
    assert {n['kind'] for n in inbox(client, headers, 'alpha')} == {'repost','follow'}
    assert unread(client, headers, 'alpha') == 2
    assert client.delete(repost, headers=headers['beta']).status_code == 204
    assert client.delete(follow, headers=headers['beta']).status_code == 204
    assert unread(client, headers, 'alpha') == 0
    assert client.post(follow, headers=headers['beta']).status_code == 204
    assert len(inbox(client, headers, 'alpha')) == 1
    assert inbox(client, headers, 'alpha')[0]['post_id'] is None
    assert client.post('/v1/users/alpha/follow', headers=headers['alpha']).status_code == 400
    assert inbox(client, headers, 'beta') == []


def test_comments_and_replies_notify_correct_recipients_and_cascade_on_delete(env):
    client, headers = env
    post_id = new_post(client, headers)
    url=f'/v1/posts/{post_id}/comments'
    assert client.post(url, headers=headers['alpha'], json={'body':'Self comment'}).status_code == 201
    assert unread(client, headers, 'alpha') == 0
    comment=client.post(url, headers=headers['beta'], json={'body':'Great observation'}).json()
    assert comment['id']
    assert unread(client, headers, 'alpha') == 1
    assert inbox(client, headers, 'alpha')[0]['comment_preview'] == 'Great observation'
    reply=client.post(url, headers=headers['gamma'], json={
        'body':'Reply to beta', 'parent_id':comment['id'],
    }).json()
    assert reply['id']
    # Post owner receives a new comment, parent commenter receives the reply.
    assert {n['kind'] for n in inbox(client, headers, 'alpha')} == {'comment'}
    assert len(inbox(client, headers, 'alpha')) == 2
    assert [n['kind'] for n in inbox(client, headers, 'beta')] == ['reply']
    assert inbox(client, headers, 'beta')[0]['comment_preview'] == 'Reply to beta'
    assert inbox(client, headers, 'gamma') == []
    assert client.delete(f"/v1/posts/{post_id}/comments/{reply['id']}",
                         headers=headers['gamma']).status_code == 204
    assert inbox(client, headers, 'beta') == []
    assert len(inbox(client, headers, 'alpha')) == 1
    assert client.delete(f"/v1/posts/{post_id}/comments/{comment['id']}",
                         headers=headers['beta']).status_code == 204
    assert inbox(client, headers, 'alpha') == []


def test_read_one_read_all_pagination_and_ownership(env):
    client, headers = env
    post_id = new_post(client, headers)
    like=f'/v1/posts/{post_id}/like'
    assert client.post(like,headers=headers['beta']).status_code == 204
    assert client.post(like,headers=headers['gamma']).status_code == 204
    assert unread(client, headers, 'alpha') == 2
    page=client.get('/v1/users/me/notifications?limit=1&offset=0',
                    headers=headers['alpha']).json()
    assert len(page)==1
    second=client.get('/v1/users/me/notifications?limit=1&offset=1',
                      headers=headers['alpha']).json()
    assert len(second)==1 and second[0]['id']!=page[0]['id']
    one=page[0]['id']
    endpoint=f'/v1/users/me/notifications/{one}/read'
    assert client.post(endpoint).status_code==401
    assert client.post(endpoint,headers=headers['beta']).status_code==404
    assert client.post(endpoint,headers=headers['alpha']).status_code==204
    assert client.post(endpoint,headers=headers['alpha']).status_code==204
    assert unread(client,headers,'alpha')==1
    assert client.post('/v1/users/me/notifications/read-all',
                       headers=headers['alpha']).status_code==204
    assert unread(client,headers,'alpha')==0
    assert all(n['read_at'] is not None for n in inbox(client,headers,'alpha'))
    assert client.get('/v1/users/me/notifications?unread_only=true',
                      headers=headers['alpha']).json()==[]
    assert client.get('/v1/users/me/notifications?limit=51',
                      headers=headers['alpha']).status_code==422


def test_notification_visibility_changes_hide_private_replies_and_deleted_posts(env):
    client, headers = env
    post_id=new_post(client, headers)
    comments=f'/v1/posts/{post_id}/comments'
    first=client.post(comments,headers=headers['beta'],json={'body':'First'}).json()
    assert client.post(comments,headers=headers['gamma'],
                       json={'body':'Reply','parent_id':first['id']}).status_code==201
    assert unread(client,headers,'beta')==1
    assert client.patch(f'/v1/posts/{post_id}',headers=headers['alpha'],
                        json={'visibility':'private'}).status_code==200
    assert inbox(client,headers,'beta')==[]
    assert unread(client,headers,'beta')==0
    # Owner can still read their own post-related notifications.
    assert unread(client,headers,'alpha')==2
    assert client.delete(f'/v1/posts/{post_id}',headers=headers['alpha']).status_code==204
    assert inbox(client,headers,'alpha')==[]
    assert inbox(client,headers,'beta')==[]
