import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnqueueEnrichmentResult,
  EnrichmentQueueRepository,
} from "../../application/enrichment.js"
import type { SqlitePort } from "../sqlite-port.js"
import { REPROCESS_PRIORITY, failure } from "./schema.js"

/**
 * 利用者からの明示的な再処理要求。所有と実行中状態を確かめてから積む。
 */

type Enqueueing = Pick<
  EnrichmentQueueRepository,
  "enqueueReprocess" | "enqueueOne"
>

// 購読を通じて所有し、かつアーカイブ済みの記事だけが再処理の対象になる。
const ownerHasArchivedArticle = (
  database: SqlitePort,
  ownerId: string,
  articleId: string
): boolean =>
  database.get(
    `SELECT 1
       FROM feed_items i
       JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
      WHERE sub.owner_id = ? AND i.article_id = ?
        AND EXISTS (
          SELECT 1 FROM article_snapshots snapshot
           WHERE json_extract(snapshot.snapshot_json, '$.articleId') = i.article_id
        )
      LIMIT 1`,
    [ownerId, articleId]
  ) !== undefined

const RESET_ON_CONFLICT = `
 ON CONFLICT(owner_id, article_id) DO UPDATE SET
   priority = excluded.priority, reason = excluded.reason,
   status = excluded.status, attempt = 0,
   lease_token = NULL, lease_expires_at = NULL,
   started_at = NULL, completed_at = NULL, error = NULL,
   created_at = excluded.created_at`

export const makeEnqueueing = (database: SqlitePort): Enqueueing => ({
  // 実行中のものは巻き込まず、結果が出ている記事だけをまとめて積み直す。
  enqueueReprocess: (ownerId, queuedAt) =>
    Effect.try({
      try: () =>
        Number(
          database.run(
            `INSERT INTO content_enrichment_queue
              (owner_id, article_id, priority, reason, status, attempt,
               published_at, created_at)
             SELECT result.owner_id, result.article_id, ?, 'Reprocess',
                    'Queued', 0,
                    COALESCE(item.published_at, item.discovered_at), ?
               FROM content_enrichment_results result
               JOIN feed_items item ON item.article_id = result.article_id
               JOIN feed_subscriptions sub
                 ON sub.feed_id = item.feed_id
                AND sub.owner_id = result.owner_id
              WHERE result.owner_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM content_enrichment_queue active
                   WHERE active.owner_id = result.owner_id
                     AND active.article_id = result.article_id
                     AND active.status = 'Processing'
                )${RESET_ON_CONFLICT}`,
            [REPROCESS_PRIORITY, queuedAt, ownerId]
          ).changes
        ),
      catch: () => failure("Enqueue"),
    }),

  enqueueOne: (ownerId, articleId, queuedAt) =>
    Effect.try({
      try: (): EnqueueEnrichmentResult =>
        database.transaction(() => {
          if (!ownerHasArchivedArticle(database, ownerId, articleId)) {
            return deepFreeze({ _tag: "NotFound" })
          }
          const active = database.get(
            `SELECT status FROM content_enrichment_queue
              WHERE owner_id = ? AND article_id = ?`,
            [ownerId, articleId]
          ) as { readonly status?: unknown } | undefined
          if (active?.status === "Processing") {
            return deepFreeze({ _tag: "Processing" })
          }
          database.run(
            `INSERT INTO content_enrichment_queue
              (owner_id, article_id, priority, reason, status, attempt,
               published_at, created_at)
             SELECT ?, item.article_id, ?, 'Reprocess', 'Queued', 0,
                    COALESCE(item.published_at, item.discovered_at), ?
               FROM feed_items item WHERE item.article_id = ?${RESET_ON_CONFLICT}`,
            [ownerId, REPROCESS_PRIORITY, queuedAt, articleId]
          )
          return deepFreeze({ _tag: "Enqueued" })
        }),
      catch: () => failure("Enqueue"),
    }),
})
