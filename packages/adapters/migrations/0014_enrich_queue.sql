-- AI補助（要約・適合度スコア・タグ付与）の優先度付き処理キュー。
-- 記事は「1回でも status='succeeded' の article_relevance を持てば処理済み」とみなし、
-- 興味プロフィール編集やタグ語彙の追加では自動再処理しない。再処理は設定・記事詳細からの
-- 明示的な要求（reason='reprocess'）でのみ投入される。
-- priority: 0 = 新着・未処理（reconcileが自動投入）, 100 = 明示再処理。
CREATE TABLE IF NOT EXISTS enrich_queue (
  owner_id TEXT NOT NULL,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('new', 'reprocess')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  PRIMARY KEY (owner_id, feed_item_id)
);

-- claim時の優先度順・新着順走査と、owner×statusの件数集計に使う。
CREATE INDEX IF NOT EXISTS idx_enrich_queue_claim
  ON enrich_queue(owner_id, status, priority, published_at, created_at);
CREATE INDEX IF NOT EXISTS idx_enrich_queue_owner_status
  ON enrich_queue(owner_id, status);
