export const articleOwnerStatesSchema = `
CREATE TABLE IF NOT EXISTS article_owner_states (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  read_later INTEGER NOT NULL DEFAULT 0 CHECK (read_later IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  hidden_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, article_id)
) STRICT;
CREATE INDEX IF NOT EXISTS article_owner_states_owner
  ON article_owner_states(owner_id, updated_at, article_id);
`
