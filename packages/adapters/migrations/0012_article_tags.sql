-- タグ機能。AIは利用者が定義した語彙(tags)の中からしか選ばない方針
-- （自由生成させると「React」「react」「React.js」のような表記ゆれが乱立し、
-- 絞り込み軸として機能しなくなるため）。語彙に無いタグをAIが出したくなった場合は
-- tag_suggestionsへ溜め、UIで「このタグを作る」導線から利用者の判断でtagsへ昇格させる。

-- 利用者が定義したタグ語彙。所有者ごとに名前は一意。
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

-- 記事へのタグ付与。手動(manual)とAI付与(ai)を区別し、AI付与にはconfidenceを持たせる。
CREATE TABLE IF NOT EXISTS article_tags (
  owner_id TEXT NOT NULL,
  feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  confidence REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, feed_item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_article_tags_feed_item
  ON article_tags(feed_item_id);

-- 語彙に無いタグをAIが提案した場合の受け皿。同名の提案が繰り返されたらoccurrences/last_seen_atを更新するだけ。
-- 「このタグを作る」導線で利用者がtagsへ昇格させたら、この行は消える運用にする。
CREATE TABLE IF NOT EXISTS tag_suggestions (
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, name)
);
