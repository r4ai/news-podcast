ALTER TABLE article_user_states ADD COLUMN read_later INTEGER NOT NULL DEFAULT 0
  CHECK (read_later IN (0, 1));
ALTER TABLE article_user_states ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0
  CHECK (hidden IN (0, 1));
ALTER TABLE article_user_states ADD COLUMN hidden_at TEXT;

-- 既定で非表示記事を除外するクエリ・後で読む絞り込みで参照する複合インデックス
CREATE INDEX IF NOT EXISTS idx_article_user_states_owner_hidden
  ON article_user_states(owner_id, hidden);
CREATE INDEX IF NOT EXISTS idx_article_user_states_owner_read_later
  ON article_user_states(owner_id, read_later);
