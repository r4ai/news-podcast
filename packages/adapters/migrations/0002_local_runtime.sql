ALTER TABLE episode_jobs ADD COLUMN stage TEXT;
ALTER TABLE episode_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE episode_jobs ADD COLUMN next_attempt_at TEXT;

CREATE TABLE IF NOT EXISTS episode_job_feeds (
  job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (job_id, position),
  UNIQUE (job_id, feed_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  owner_id TEXT PRIMARY KEY,
  schedule_enabled INTEGER NOT NULL DEFAULT 0 CHECK (schedule_enabled IN (0, 1)),
  schedule_local_time TEXT NOT NULL DEFAULT '07:30',
  schedule_time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  last_scheduled_local_date TEXT
);

ALTER TABLE episodes ADD COLUMN audio_byte_length INTEGER;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episode_jobs_retry
  ON episode_jobs(status, next_attempt_at, lease_expires_at, created_at);
