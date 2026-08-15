import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { EnrichmentQueueError } from "../../application/enrichment.js"
import { contentTaxonomySchema } from "../sqlite-content-taxonomy.js"

/**
 * AI補完キューの永続化スキーマと、行の復号に共通して使う語彙。
 */

export const NEW_PRIORITY = 0
export const REPROCESS_PRIORITY = 100

export const enrichmentQueueSchema = `
${contentTaxonomySchema}
CREATE TABLE IF NOT EXISTS content_enrichment_results (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('Succeeded', 'Failed')),
  summary TEXT,
  score INTEGER CHECK(score IS NULL OR (score >= 0 AND score <= 100)),
  reason TEXT,
  error TEXT,
  tokens_in INTEGER NOT NULL CHECK(tokens_in >= 0),
  tokens_out INTEGER NOT NULL CHECK(tokens_out >= 0),
  completed_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, article_id)
) STRICT;
CREATE TABLE IF NOT EXISTS content_enrichment_queue (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('New', 'Reprocess')),
  status TEXT NOT NULL CHECK(status IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  PRIMARY KEY(owner_id, article_id)
) STRICT;
CREATE INDEX IF NOT EXISTS content_enrichment_queue_claim
  ON content_enrichment_queue(owner_id, status, priority, published_at, created_at);
CREATE TABLE IF NOT EXISTS content_enrichment_daily_progress (
  local_date TEXT PRIMARY KEY,
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count >= 0)
) STRICT;
`

export const TargetRowSchema = Schema.Struct({
  articleId: Schema.String,
  title: Schema.String,
  markdownKey: Schema.String,
  leaseToken: Schema.String,
})
export const QueueRowSchema = Schema.Struct({
  articleId: Schema.String,
  title: Schema.String,
  priority: Schema.Int,
  reason: Schema.String,
  status: Schema.String,
  attempt: Schema.Int,
  error: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})
export const CountRowSchema = Schema.Struct({ count: Schema.Int })
export const OwnerRowSchema = Schema.Struct({ ownerId: Schema.String })

export const failure = (
  operation: EnrichmentQueueError["operation"],
  reason: EnrichmentQueueError["reason"] = "Unavailable"
): EnrichmentQueueError =>
  deepFreeze({ _tag: "EnrichmentQueueFailed", operation, reason })

export const parseCount = (
  row: unknown,
  operation: EnrichmentQueueError["operation"]
) =>
  parse(CountRowSchema)(row).pipe(
    Effect.map(({ count }) => count),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )
