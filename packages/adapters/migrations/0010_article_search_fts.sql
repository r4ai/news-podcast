-- 記事検索をLIKEからFTS5全文検索へ移行する。
-- トークナイザはtrigramを使う。日本語は空白で語を区切らないため既定のunicode61では
-- 「日本語全文検索」のような複合語の部分一致を拾えない。trigramなら3文字以上の任意の
-- 部分文字列で一致するため、日英どちらの部分一致検索も同じ仕組みで扱える。
-- 代償として索引サイズは元テキストの3〜4倍に膨らむが、記事本文の全文検索を実用にする
-- ためのコストとして許容する。
--
-- feed_items.id はTEXT主キーでcontent=外部コンテンツ方式のrowid対応に使えず、また
-- 本文(body)はfeed_itemsに存在しない（オブジェクトストアのMarkdownが原本）ため、
-- content=方式ではなく独立したFTS5テーブルにする。同期はfeed_itemsの暗黙のrowidを
-- そのままfeed_items_ftsのrowidとして使うことで、外部キー的な対応を安価に保つ。
CREATE VIRTUAL TABLE IF NOT EXISTS feed_items_fts USING fts5(
  title,
  summary,
  body,
  body_indexed_at UNINDEXED,
  tokenize = 'trigram'
);

-- 既存のfeed_itemsを初期投入する。bodyはワーカーがアーカイブ成功時/バックフィルで
-- 別途投入するためここでは空文字のままにする。
INSERT INTO feed_items_fts (rowid, title, summary, body, body_indexed_at)
SELECT rowid, title, COALESCE(summary, ''), '', NULL FROM feed_items;

-- title/summaryをfeed_itemsのINSERT/UPDATE/DELETEに追従させるトリガ。
-- bodyとbody_indexed_atはここでは触らず、ワーカー側の投入結果を保持する。
CREATE TRIGGER IF NOT EXISTS trg_feed_items_fts_insert
AFTER INSERT ON feed_items
BEGIN
  INSERT INTO feed_items_fts (rowid, title, summary, body, body_indexed_at)
  VALUES (new.rowid, new.title, COALESCE(new.summary, ''), '', NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_feed_items_fts_update
AFTER UPDATE OF title, summary ON feed_items
BEGIN
  UPDATE feed_items_fts
  SET title = new.title, summary = COALESCE(new.summary, '')
  WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS trg_feed_items_fts_delete
AFTER DELETE ON feed_items
BEGIN
  DELETE FROM feed_items_fts WHERE rowid = old.rowid;
END;
