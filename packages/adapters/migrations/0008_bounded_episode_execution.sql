ALTER TABLE episode_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 4;
ALTER TABLE episode_jobs ADD COLUMN stage_started_at TEXT;
ALTER TABLE episode_jobs ADD COLUMN last_progress_at TEXT;
ALTER TABLE episode_jobs ADD COLUMN deadline_at TEXT;
ALTER TABLE episode_jobs ADD COLUMN heartbeat_at TEXT;
ALTER TABLE episode_jobs ADD COLUMN progress_completed INTEGER;
ALTER TABLE episode_jobs ADD COLUMN progress_total INTEGER;

CREATE TABLE episode_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  stage TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_episode_job_events_job_created
  ON episode_job_events(job_id, created_at, id);

CREATE TABLE episode_job_drafts (
  job_id TEXT PRIMARY KEY REFERENCES episode_jobs(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  script TEXT NOT NULL CHECK (length(script) <= 6000),
  source_urls_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE episode_audio_chunks (
  job_id TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 16777216),
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, input_hash, position)
);

CREATE TABLE object_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 20),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO episode_job_events (
  id, job_id, event_type, attempt, stage, payload_json, created_at
)
SELECT lower(hex(randomblob(16))), id, 'legacy_execution_invalidated', attempt,
       stage, json_object('original_attempt', attempt),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM episode_jobs
WHERE status IN ('queued', 'running', 'retrying') OR attempt > 4;

UPDATE episode_jobs
SET status = 'failed',
    finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    failure_code = 'legacy-execution-invalidated',
    failure_message = '旧実行方式の未完了ジョブを安全のため停止しました。手動で再試行してください。',
    failure_retryable = 1,
    stage = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL
WHERE status IN ('queued', 'running', 'retrying');

UPDATE episode_jobs SET attempt = 4 WHERE attempt > 4;

CREATE TRIGGER episode_jobs_attempt_insert_guard
BEFORE INSERT ON episode_jobs
WHEN NEW.attempt < 0 OR NEW.attempt > 4 OR NEW.max_attempts != 4
BEGIN
  SELECT RAISE(ABORT, 'episode-job-attempt-out-of-range');
END;

CREATE TRIGGER episode_jobs_attempt_update_guard
BEFORE UPDATE OF attempt, max_attempts ON episode_jobs
WHEN NEW.attempt < 0 OR NEW.attempt > 4 OR NEW.max_attempts != 4
BEGIN
  SELECT RAISE(ABORT, 'episode-job-attempt-out-of-range');
END;

CREATE TRIGGER episode_jobs_running_lease_insert_guard
BEFORE INSERT ON episode_jobs
WHEN NEW.status = 'running'
 AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL OR NEW.heartbeat_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'running-job-requires-lease');
END;

CREATE TRIGGER episode_jobs_running_lease_update_guard
BEFORE UPDATE OF status, lease_token, lease_expires_at, heartbeat_at ON episode_jobs
WHEN NEW.status = 'running'
 AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL OR NEW.heartbeat_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'running-job-requires-lease');
END;

CREATE TRIGGER episode_jobs_nonrunning_lease_insert_guard
BEFORE INSERT ON episode_jobs
WHEN NEW.status != 'running'
 AND (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.heartbeat_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'nonrunning-job-cannot-hold-lease');
END;

CREATE TRIGGER episode_jobs_nonrunning_lease_update_guard
BEFORE UPDATE OF status, lease_token, lease_expires_at, heartbeat_at ON episode_jobs
WHEN NEW.status != 'running'
 AND (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.heartbeat_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'nonrunning-job-cannot-hold-lease');
END;

CREATE TRIGGER episode_jobs_terminal_insert_guard
BEFORE INSERT ON episode_jobs
WHEN NEW.status IN ('succeeded', 'failed', 'canceled') AND NEW.finished_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'terminal-job-requires-finished-at');
END;

CREATE TRIGGER episode_jobs_terminal_update_guard
BEFORE UPDATE OF status, finished_at ON episode_jobs
WHEN NEW.status IN ('succeeded', 'failed', 'canceled') AND NEW.finished_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'terminal-job-requires-finished-at');
END;
