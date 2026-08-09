ALTER TABLE feed_catalog ADD COLUMN created_by_owner_id TEXT;
ALTER TABLE feed_catalog ADD COLUMN last_synced_at TEXT;
ALTER TABLE feed_catalog ADD COLUMN next_sync_at TEXT;
ALTER TABLE feed_catalog ADD COLUMN sync_error TEXT;

CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  summary TEXT,
  discovered_at TEXT NOT NULL,
  archive_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (archive_status IN ('pending', 'archiving', 'succeeded', 'failed')),
  archive_error TEXT,
  archive_attempt INTEGER NOT NULL DEFAULT 0,
  next_archive_at TEXT,
  latest_snapshot_id TEXT,
  UNIQUE (feed_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_feed_published
  ON feed_items(feed_id, published_at DESC, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_archive
  ON feed_items(archive_status, next_archive_at, discovered_at);

CREATE TABLE IF NOT EXISTS article_snapshots (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  replay_key TEXT NOT NULL,
  markdown_key TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  UNIQUE (feed_item_id, content_hash)
);

CREATE TABLE IF NOT EXISTS archive_assets (
  snapshot_id TEXT NOT NULL REFERENCES article_snapshots(id) ON DELETE CASCADE,
  asset_hash TEXT NOT NULL,
  original_url TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, asset_hash)
);

CREATE TABLE IF NOT EXISTS article_user_states (
  owner_id TEXT NOT NULL,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, feed_item_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  episode_job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  turn_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failure_code TEXT
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (agent_run_id, position)
);

ALTER TABLE episode_sources ADD COLUMN snapshot_id TEXT;
ALTER TABLE episode_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'rss';
