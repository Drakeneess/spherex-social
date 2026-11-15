"""PostgreSQL transactional change signals for AstroGram SSE.

Notifications are emitted by database triggers *at commit*, so a rolled-back
like, post or follow never produces a phantom client update. No message body,
birth date, email, private image, or other personal data enters the channel.

Revision ID: d3e2f1a0b9c8
Revises: b8217e5d6a90
"""
from alembic import op

revision = "d3e2f1a0b9c8"
down_revision = "b8217e5d6a90"
branch_labels = None
depends_on = None

TABLES = (
    "posts", "post_likes", "post_reposts", "comments", "bookmarks",
    "notifications", "follows", "users", "sky_search_jobs",
)


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
    CREATE FUNCTION astrogram_notify_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      row_data jsonb;
      post_visibility text;
      owner_id uuid;
      prior_visibility text;
      next_visibility text;
      actor_username text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        row_data := to_jsonb(OLD);
      ELSE
        row_data := to_jsonb(NEW);
      END IF;

      IF TG_TABLE_NAME = 'posts' THEN
        prior_visibility := NULL;
        next_visibility := NULL;
        IF TG_OP <> 'INSERT' THEN prior_visibility := OLD.visibility; END IF;
        IF TG_OP <> 'DELETE' THEN next_visibility := NEW.visibility; END IF;
        IF prior_visibility = 'public' OR next_visibility = 'public' THEN
          PERFORM pg_notify('astrogram_events', json_build_object(
            'kind','feed','post_id',row_data->>'id')::text);
        END IF;
        PERFORM pg_notify('astrogram_events', json_build_object(
          'kind','profile_posts','scope','user','user_id',row_data->>'author_id')::text);

      ELSIF TG_TABLE_NAME IN ('post_likes','post_reposts','comments') THEN
        SELECT visibility, author_id INTO post_visibility, owner_id
          FROM posts WHERE id = (row_data->>'post_id')::uuid;
        IF post_visibility = 'public' THEN
          PERFORM pg_notify('astrogram_events', json_build_object(
            'kind', CASE WHEN TG_TABLE_NAME = 'comments' THEN 'comments' ELSE 'interaction' END,
            'post_id', row_data->>'post_id')::text);
        ELSIF post_visibility = 'unlisted' THEN
          -- A direct-link reader must not learn any other unlisted post ID.
          PERFORM pg_notify('astrogram_events', '{"kind":"interaction"}');
        ELSIF owner_id IS NOT NULL THEN
          PERFORM pg_notify('astrogram_events', json_build_object(
            'kind','interaction','scope','user','user_id',owner_id::text,
            'post_id',row_data->>'post_id')::text);
        END IF;
        IF TG_TABLE_NAME = 'post_reposts' THEN
          SELECT username INTO actor_username FROM users
            WHERE id = (row_data->>'user_id')::uuid;
          IF actor_username IS NOT NULL THEN
            PERFORM pg_notify('astrogram_events', json_build_object(
              'kind','profile_posts','username',actor_username)::text);
          END IF;
        END IF;

      ELSIF TG_TABLE_NAME = 'notifications' THEN
        PERFORM pg_notify('astrogram_events', json_build_object(
          'kind','notifications','scope','user',
          'user_id',row_data->>'recipient_id')::text);

      ELSIF TG_TABLE_NAME = 'bookmarks' THEN
        PERFORM pg_notify('astrogram_events', json_build_object(
          'kind','bookmarks','scope','user','user_id',row_data->>'user_id')::text);

      ELSIF TG_TABLE_NAME = 'follows' THEN
        PERFORM pg_notify('astrogram_events', '{"kind":"profile_stats"}');

      ELSIF TG_TABLE_NAME = 'users' THEN
        IF TG_OP = 'UPDATE' THEN
          -- Private edits (including a hidden birth date) never signal public
          -- profile changes; only the account owner needs a refresh.
          PERFORM pg_notify('astrogram_events', json_build_object(
            'kind','profile','scope','user',
            'user_id',NEW.id::text,'username',NEW.username)::text);
          IF ROW(OLD.username, OLD.display_name, OLD.bio, OLD.website,
                 OLD.avatar_version, OLD.cover_version,
                 OLD.avatar_color_start, OLD.avatar_color_end,
                 OLD.cover_color_start, OLD.cover_color_end,
                 OLD.show_birthday,
                 CASE WHEN OLD.show_birthday THEN OLD.birth_date ELSE NULL END)
             IS DISTINCT FROM
             ROW(NEW.username, NEW.display_name, NEW.bio, NEW.website,
                 NEW.avatar_version, NEW.cover_version,
                 NEW.avatar_color_start, NEW.avatar_color_end,
                 NEW.cover_color_start, NEW.cover_color_end,
                 NEW.show_birthday,
                 CASE WHEN NEW.show_birthday THEN NEW.birth_date ELSE NULL END)
          THEN
            PERFORM pg_notify('astrogram_events', json_build_object(
              'kind','profile','username',NEW.username)::text);
          END IF;
        END IF;

      ELSIF TG_TABLE_NAME = 'sky_search_jobs' THEN
        PERFORM pg_notify('astrogram_events', json_build_object(
          'kind','sky_job','job_id',row_data->>'id')::text);
      END IF;

      RETURN NULL;
    END
    $$;
    """)
    for table in TABLES:
        events = "INSERT OR UPDATE OR DELETE"
        if table == "sky_search_jobs":
            events = "INSERT OR UPDATE OF status, frame_states, result_data OR DELETE"
        if table == "users":
            events = "UPDATE OF username, display_name, bio, website, avatar_version, cover_version, avatar_color_start, avatar_color_end, cover_color_start, cover_color_end, birth_date, show_birthday"
        op.execute(
            "CREATE TRIGGER astrogram_realtime_" + table +
            " AFTER " + events + " ON " + table +
            " FOR EACH ROW EXECUTE FUNCTION astrogram_notify_change()"
        )


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in reversed(TABLES):
        op.execute("DROP TRIGGER IF EXISTS astrogram_realtime_" +
                   table + " ON " + table)
    op.execute("DROP FUNCTION IF EXISTS astrogram_notify_change()")
