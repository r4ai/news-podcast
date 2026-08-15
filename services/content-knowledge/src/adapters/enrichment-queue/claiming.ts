import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { EnrichmentQueueRepository } from "../../application/enrichment.js"
import {
  ENRICHMENT_MAX_ATTEMPTS,
  EnrichmentTargetSchema,
} from "../../domain/enrichment.js"
import { OwnerIdSchema } from "../../domain/subscription.js"
import type { SqlitePort } from "../sqlite-port.js"
import {
  NEW_PRIORITY,
  OwnerRowSchema,
  TargetRowSchema,
  failure,
} from "./schema.js"

/**
 * キューの入口側：期限切れリースの回収、未処理記事の投入、そして排他的な取得。
 */

type Claiming = Pick<
  EnrichmentQueueRepository,
  "reconcile" | "listOwners" | "claim"
>

export const makeClaiming = (database: SqlitePort): Claiming => ({
  // 期限切れのリースをQueuedへ戻したうえで、未処理の購読記事を取りこぼさず補充する。
  reconcile: (now) =>
    Effect.try({
      try: () =>
        database.transaction(() => {
          database.run(
            `UPDATE content_enrichment_queue
                SET status = 'Queued', lease_token = NULL,
                    lease_expires_at = NULL, started_at = NULL
              WHERE status = 'Processing'
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at < ?`,
            [now]
          )
          database.run(
            `INSERT OR IGNORE INTO content_enrichment_queue
              (owner_id, article_id, priority, reason, status, attempt,
               published_at, created_at)
             SELECT sub.owner_id, item.article_id, ?, 'New', 'Queued', 0,
                    COALESCE(item.published_at, item.discovered_at), ?
               FROM feed_items item
               JOIN feed_subscriptions sub ON sub.feed_id = item.feed_id
              WHERE EXISTS (
                      SELECT 1 FROM article_snapshots snapshot
                       WHERE json_extract(snapshot.snapshot_json, '$.articleId') = item.article_id
                    )
                AND NOT EXISTS (
                      SELECT 1 FROM content_enrichment_results result
                       WHERE result.owner_id = sub.owner_id
                         AND result.article_id = item.article_id
                    )`,
            [NEW_PRIORITY, now]
          )
        }),
      catch: () => failure("Reconcile"),
    }),

  listOwners: () =>
    Effect.try({
      try: () =>
        database.all(
          `SELECT DISTINCT owner_id AS ownerId
             FROM feed_subscriptions
            ORDER BY owner_id`
        ),
      catch: () => failure("ListOwners"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          parse(OwnerRowSchema)(row).pipe(
            Effect.flatMap(({ ownerId }) => parse(OwnerIdSchema)(ownerId)),
            Effect.mapError(() => failure("ListOwners", "CorruptRecord"))
          )
        )
      ),
      Effect.map(deepFreeze)
    ),

  // 候補を1件ずつ条件付き更新で押さえ、実際に取れたものだけを返す。
  claim: (ownerId, limit, now, expiresAt, leaseToken) => {
    if (limit <= 0) return Effect.succeed(deepFreeze([]))
    return Effect.try({
      try: () =>
        database.transaction(() => {
          const candidates = database.all(
            `SELECT queue.article_id AS articleId,
                    item.title AS title,
                    json_extract(snapshot.snapshot_json, '$.capture.markdown.key') AS markdownKey
               FROM content_enrichment_queue queue
               JOIN feed_items item ON item.article_id = queue.article_id
               JOIN article_snapshots snapshot ON snapshot.rowid = (
                 SELECT latest.rowid FROM article_snapshots latest
                  WHERE json_extract(latest.snapshot_json, '$.articleId') = item.article_id
                  ORDER BY latest.captured_at DESC, latest.snapshot_id DESC
                  LIMIT 1
               )
              WHERE queue.owner_id = ?
                AND queue.status IN ('Queued', 'Failed')
                AND queue.attempt < ?
              ORDER BY queue.priority ASC,
                       queue.published_at DESC,
                       queue.created_at ASC,
                       queue.article_id ASC
              LIMIT ?`,
            [ownerId, ENRICHMENT_MAX_ATTEMPTS, limit]
          )
          const claimed: unknown[] = []
          for (const candidate of candidates) {
            const row = Schema.decodeUnknownSync(TargetRowSchema)({
              ...(candidate as object),
              leaseToken,
            })
            const updated = database.run(
              `UPDATE content_enrichment_queue
                  SET status = 'Processing', lease_token = ?,
                      lease_expires_at = ?, started_at = ?, completed_at = NULL
                WHERE owner_id = ? AND article_id = ?
                  AND status IN ('Queued', 'Failed')
                  AND attempt < ?`,
              [
                leaseToken,
                expiresAt,
                now,
                ownerId,
                row.articleId,
                ENRICHMENT_MAX_ATTEMPTS,
              ]
            )
            if (Number(updated.changes) === 1) claimed.push(row)
          }
          return claimed
        }),
      catch: () => failure("Claim"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          parse(EnrichmentTargetSchema)(row).pipe(
            Effect.mapError(() => failure("Claim", "CorruptRecord"))
          )
        )
      ),
      Effect.map(deepFreeze)
    )
  },
})
