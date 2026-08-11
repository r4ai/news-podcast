-- 生成対象として明示選択された記事。ジョブ作成時に凍結し、再試行でも引き継ぐ。
-- episode_job_feeds と同じ「作成時スナップショット」の扱い。
CREATE TABLE episode_job_articles (
  job_id       TEXT NOT NULL REFERENCES episode_jobs(id) ON DELETE CASCADE,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  PRIMARY KEY (job_id, feed_item_id)
);

CREATE INDEX idx_episode_job_articles_job_position
  ON episode_job_articles(job_id, position);

-- SSE 配信の単調カーソル。NULL で追加 → backfill → UNIQUE の順でなければ
-- 同一ジョブの既存行がデフォルト値で衝突する。
ALTER TABLE episode_job_events ADD COLUMN sequence INTEGER;

UPDATE episode_job_events
SET sequence = (
  SELECT rn
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY job_id ORDER BY created_at, id
           ) AS rn
    FROM episode_job_events
  ) ordered
  WHERE ordered.id = episode_job_events.id
);

CREATE UNIQUE INDEX idx_episode_job_events_job_sequence
  ON episode_job_events(job_id, sequence);
