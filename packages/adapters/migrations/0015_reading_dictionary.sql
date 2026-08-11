-- 読み辞書。専門用語や固有名詞の読みを登録し、VOICEVOX user_dict_wordに同期する。
-- surfaceとreadingの組み合わせはownerごとに一意。
CREATE TABLE IF NOT EXISTS reading_dictionary (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  reading TEXT NOT NULL,
  accent_type INTEGER NOT NULL DEFAULT 0,
  word_uuid TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai_auto')),
  episode_job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, surface)
);

CREATE INDEX IF NOT EXISTS idx_reading_dictionary_owner
  ON reading_dictionary(owner_id);
