import { and, eq, gt, lt, sql } from "drizzle-orm"
import { Effect } from "effect"

import {
  contentEnrichmentDailyProgress,
  contentEnrichmentQueue,
} from "../../../../drizzle/schema.js"
import type { EnrichmentQueueRepository } from "../../../application/enrichment.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { failure } from "./row.js"

type Budget = Pick<EnrichmentQueueRepository, "reserveAttempt">

const STALE_LEASE = "stale enrichment lease"

/** Atomically binds one paid provider attempt to a live queue lease. */
export const makeBudget = (database: ContentKnowledgeDatabase): Budget => ({
  reserveAttempt: (ownerId, target, attemptedAt, localDate, dailyLimit) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          const lease = tx
            .select({ articleId: contentEnrichmentQueue.articleId })
            .from(contentEnrichmentQueue)
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                eq(contentEnrichmentQueue.articleId, target.articleId),
                eq(contentEnrichmentQueue.status, "Processing"),
                eq(contentEnrichmentQueue.leaseToken, target.leaseToken),
                gt(contentEnrichmentQueue.leaseExpiresAt, attemptedAt)
              )
            )
            .get()
          if (lease === undefined) throw new Error(STALE_LEASE)

          tx.insert(contentEnrichmentDailyProgress)
            .values({ ownerId, localDate, attemptedCount: 0 })
            .onConflictDoNothing()
            .run()
          const reserved = tx
            .update(contentEnrichmentDailyProgress)
            .set({
              attemptedCount: sql`${contentEnrichmentDailyProgress.attemptedCount} + 1`,
            })
            .where(
              and(
                eq(contentEnrichmentDailyProgress.ownerId, ownerId),
                eq(contentEnrichmentDailyProgress.localDate, localDate),
                lt(contentEnrichmentDailyProgress.attemptedCount, dailyLimit)
              )
            )
            .run()
          if (Number(reserved.changes) === 1) return true

          tx.update(contentEnrichmentQueue)
            .set({
              status: "Queued",
              leaseToken: null,
              leaseExpiresAt: null,
              startedAt: null,
            })
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                eq(contentEnrichmentQueue.articleId, target.articleId),
                eq(contentEnrichmentQueue.status, "Processing"),
                eq(contentEnrichmentQueue.leaseToken, target.leaseToken)
              )
            )
            .run()
          return false
        }),
      catch: () => failure("Budget"),
    }),
})
