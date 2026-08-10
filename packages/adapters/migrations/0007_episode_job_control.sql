ALTER TABLE episode_jobs ADD COLUMN retry_of_job_id TEXT REFERENCES episode_jobs(id);
ALTER TABLE episode_jobs ADD COLUMN memory_version_id TEXT;
ALTER TABLE episode_jobs ADD COLUMN generation_policy_hash TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX idx_episode_jobs_retry_origin
  ON episode_jobs(owner_id, retry_of_job_id, created_at);
