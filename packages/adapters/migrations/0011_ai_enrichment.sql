-- RSS記事へのAI補助（日本語要約・適合度スコア）を保存する。
-- 要約(article_summaries)は記事本文にのみ依存するため所有者非依存で1行/スナップショット。
-- スコア(article_relevance)は所有者ごとの興味プロフィールに依存するため所有者ごとに1行/記事。
-- 両者を分けることで、同じ記事を購読する複数ownerがいても要約の再生成コストを払わずに済む。

-- 興味プロフィール（自由記述のinclude/exclude）と、その本文から計算したハッシュ。
-- ハッシュはプロフィール変更時に古いarticle_relevance行を「未処理」とみなすための識別子。
ALTER TABLE user_settings ADD COLUMN interest_include TEXT NOT NULL DEFAULT '';
ALTER TABLE user_settings ADD COLUMN interest_exclude TEXT NOT NULL DEFAULT '';
ALTER TABLE user_settings ADD COLUMN interest_profile_hash TEXT NOT NULL DEFAULT '';

-- 要約: 記事スナップショット単位（所有者非依存）。プロンプト版が変わったら別行として再生成する
-- （PRIMARY KEYはsnapshot_idのみなので、版が変わったら既存行をUPDATEで置き換える運用にする）。
CREATE TABLE IF NOT EXISTS article_summaries (
  snapshot_id TEXT PRIMARY KEY REFERENCES article_snapshots(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- スコア+理由: 所有者×記事単位。profile_hash/prompt_versionが現在値と一致しない行は
-- 「未処理」として再計算対象になる（一致する行だけがAPI応答やsort=relevanceで使われる）。
CREATE TABLE IF NOT EXISTS article_relevance (
  owner_id TEXT NOT NULL,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  profile_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  score INTEGER,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, feed_item_id)
);

CREATE INDEX IF NOT EXISTS idx_article_relevance_feed_item
  ON article_relevance(feed_item_id);

-- 日次バッチの処理件数上限（AI_ENRICH_DAILY_LIMIT）を跨tick・跨owner・跨プロセス再起動で
-- 遵守するためのカウンタ。ローカル日付ごとに1行。
CREATE TABLE IF NOT EXISTS ai_enrich_daily_progress (
  local_date TEXT PRIMARY KEY,
  processed_count INTEGER NOT NULL DEFAULT 0
);
