import { eq, sql } from "drizzle-orm"

import { articleSnapshots, feedItems } from "../../../drizzle/schema.js"

/**
 * 記事ごとの最新スナップショット。
 * captured_at が同じ場合は snapshot_id の降順で決定的に選ぶ。
 */
const latestSnapshotId = sql`(
  SELECT candidate.snapshot_id
    FROM article_snapshots AS candidate
   WHERE candidate.article_id = ${feedItems.articleId}
   ORDER BY candidate.captured_at DESC, candidate.snapshot_id DESC
   LIMIT 1
)`

export const latestSnapshotOfArticle = eq(
  articleSnapshots.snapshotId,
  latestSnapshotId
)
