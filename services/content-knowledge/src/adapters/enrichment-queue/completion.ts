import { Effect } from "effect"

import type { EnrichmentQueueRepository } from "../../application/enrichment.js"
import { ENRICHMENT_MAX_ATTEMPTS } from "../../domain/enrichment.js"
import type { SqlitePort } from "../sqlite-port.js"
import { failure } from "./schema.js"

/**
 * キューの出口側：リースを保持していた実行だけが結果を確定できる。
 * 成功時はタグと候補語彙、日次消費までを同じトランザクションで書き切る。
 */

type Completion = Pick<
  EnrichmentQueueRepository,
  "completeSuccess" | "completeFailure"
>

const STALE_LEASE = "stale enrichment lease"

export const makeCompletion = (database: SqlitePort): Completion => ({
  completeSuccess: (ownerId, target, output, completedAt, localDate) =>
    Effect.try({
      try: () =>
        database.transaction(() => {
          const completed = database.run(
            `UPDATE content_enrichment_queue
                SET status = 'Succeeded', lease_token = NULL,
                    lease_expires_at = NULL, completed_at = ?, error = NULL
              WHERE owner_id = ? AND article_id = ?
                AND status = 'Processing' AND lease_token = ?`,
            [completedAt, ownerId, target.articleId, target.leaseToken]
          )
          if (Number(completed.changes) !== 1) throw new Error(STALE_LEASE)

          database.run(
            `INSERT INTO content_enrichment_results
              (owner_id, article_id, status, summary, score, reason, error,
               tokens_in, tokens_out, completed_at)
             VALUES (?, ?, 'Succeeded', ?, ?, ?, NULL, ?, ?, ?)
             ON CONFLICT(owner_id, article_id) DO UPDATE SET
               status = excluded.status, summary = excluded.summary,
               score = excluded.score, reason = excluded.reason,
               error = excluded.error, tokens_in = excluded.tokens_in,
               tokens_out = excluded.tokens_out,
               completed_at = excluded.completed_at`,
            [
              ownerId,
              target.articleId,
              output.summary,
              output.score,
              output.reason,
              output.tokensIn,
              output.tokensOut,
              completedAt,
            ]
          )

          // AI由来のタグは毎回入れ替える。手動で付けたタグには触れない。
          database.run(
            `DELETE FROM content_article_tags
              WHERE owner_id = ? AND article_id = ? AND source = 'Ai'`,
            [ownerId, target.articleId]
          )
          for (const name of output.tags) {
            database.run(
              `INSERT INTO content_article_tags
                (owner_id, article_id, tag_id, source, confidence, created_at)
               SELECT ?, ?, tag_id, 'Ai', 1, ?
                 FROM content_tags
                WHERE owner_id = ? AND name = ?
               ON CONFLICT(owner_id, article_id, tag_id) DO NOTHING`,
              [ownerId, target.articleId, completedAt, ownerId, name]
            )
          }
          // 既存語彙にない名前だけを候補として数え上げる。
          for (const name of new Set(output.suggestedTags)) {
            const vocabulary = database.get(
              "SELECT 1 FROM content_tags WHERE owner_id = ? AND name = ?",
              [ownerId, name]
            )
            if (vocabulary !== undefined) continue
            database.run(
              `INSERT INTO content_tag_suggestions
                (owner_id, name, occurrences, last_seen_at)
               VALUES (?, ?, 1, ?)
               ON CONFLICT(owner_id, name) DO UPDATE SET
                 occurrences = occurrences + 1,
                 last_seen_at = excluded.last_seen_at`,
              [ownerId, name, completedAt]
            )
          }

          database.run(
            `INSERT INTO content_enrichment_daily_progress(local_date, processed_count)
             VALUES (?, 1)
             ON CONFLICT(local_date) DO UPDATE SET
               processed_count = processed_count + 1`,
            [localDate]
          )
        }),
      catch: () => failure("Complete"),
    }),

  // 再試行できない失敗は、試行回数を上限へ飛ばして即座に終端させる。
  completeFailure: (ownerId, target, error, retryable, completedAt) =>
    Effect.try({
      try: () =>
        database.transaction(() => {
          const result = database.run(
            `UPDATE content_enrichment_queue
              SET status = 'Failed',
                  attempt = CASE WHEN ? = 1 THEN attempt + 1 ELSE ? END,
                  lease_token = NULL, lease_expires_at = NULL,
                  completed_at = ?, error = ?
            WHERE owner_id = ? AND article_id = ?
              AND status = 'Processing' AND lease_token = ?`,
            [
              retryable ? 1 : 0,
              ENRICHMENT_MAX_ATTEMPTS,
              completedAt,
              error,
              ownerId,
              target.articleId,
              target.leaseToken,
            ]
          )
          if (Number(result.changes) !== 1) throw new Error(STALE_LEASE)

          database.run(
            `INSERT INTO content_enrichment_results
              (owner_id, article_id, status, summary, score, reason, error,
               tokens_in, tokens_out, completed_at)
             VALUES (?, ?, 'Failed', NULL, NULL, NULL, ?, 0, 0, ?)
             ON CONFLICT(owner_id, article_id) DO UPDATE SET
               status = excluded.status, summary = NULL, score = NULL,
               reason = NULL, error = excluded.error,
               tokens_in = 0, tokens_out = 0,
               completed_at = excluded.completed_at`,
            [ownerId, target.articleId, error, completedAt]
          )
        }),
      catch: () => failure("Complete"),
    }),
})
