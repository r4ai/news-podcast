PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS feed_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, feed_id)
);

CREATE TABLE IF NOT EXISTS episode_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'succeeded', 'failed', 'canceled')),
  receipt_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  episode_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  failure_retryable INTEGER CHECK (failure_retryable IN (0, 1)),
  lease_token TEXT,
  lease_expires_at TEXT,
  UNIQUE (owner_id, idempotency_route, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_episode_jobs_ready
  ON episode_jobs(status, available_at, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  script TEXT NOT NULL,
  audio_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_owner_created
  ON episodes(owner_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS episode_sources (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  PRIMARY KEY (episode_id, position)
);

CREATE TABLE IF NOT EXISTS job_outbox (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_outbox_pending
  ON job_outbox(dispatched_at, created_at);

INSERT OR IGNORE INTO feed_catalog (id, name, site_url, feed_url, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Zenn', 'https://zenn.dev/', 'https://zenn.dev/feed', '2026-08-09T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000002', 'azukiazusaのテックブログ2', 'https://azukiazusa.dev/', 'https://azukiazusa.dev/rss.xml', '2026-08-09T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000003', 'Hacker News', 'https://news.ycombinator.com/', 'https://news.ycombinator.com/rss', '2026-08-09T00:00:00.000Z');
