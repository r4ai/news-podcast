import { and, eq, inArray, sql } from "drizzle-orm"
import { feedSubscriptions, feedSyncJobs } from "../../../../drizzle/schema.js"
import type { QueryRunner } from "../../../infrastructure/unsafe/drizzle/open.js"

export const FEED_SYNC_ACTIVE_LIMIT = 6
export const FEED_SYNC_OWNER_LIMIT = 2
export const nextReadySequence = (tx: QueryRunner): number =>
  tx
    .select({
      value: sql<number>`coalesce(max(${feedSyncJobs.readySequence}), 0) + 1`,
    })
    .from(feedSyncJobs)
    .get()!.value

/** Count every active job so subscription toggles cannot bypass the global bound. */
export const canAdmitFeed = (tx: QueryRunner, feedId: string): boolean => {
  const active = inArray(feedSyncJobs.status, ["Queued", "Processing"])
  const total = tx
    .select({ value: sql<number>`count(*)` })
    .from(feedSyncJobs)
    .where(active)
    .get()!.value
  if (total >= FEED_SYNC_ACTIVE_LIMIT) return false
  const owners = tx
    .select({ ownerId: feedSubscriptions.ownerId })
    .from(feedSubscriptions)
    .where(
      and(
        eq(feedSubscriptions.feedId, feedId),
        eq(feedSubscriptions.enabled, 1)
      )
    )
    .all()
  return owners.some(({ ownerId }) => {
    const count = tx
      .select({ value: sql<number>`count(*)` })
      .from(feedSyncJobs)
      .innerJoin(
        feedSubscriptions,
        eq(feedSubscriptions.feedId, feedSyncJobs.feedId)
      )
      .where(and(active, eq(feedSubscriptions.ownerId, ownerId)))
      .get()!.value
    return count < FEED_SYNC_OWNER_LIMIT
  })
}
