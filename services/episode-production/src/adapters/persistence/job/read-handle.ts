import { and, asc, desc, eq, gt, sql } from "drizzle-orm"

import {
  episodeJobs,
  episodeJobAguiEvents,
} from "../../../../drizzle/schema.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type {
  JobReadHandle,
  SqliteJobStatusSnapshot,
  StoredJobAgUiEventRow,
} from "./ports.js"
import { documentOfJob, selectJob } from "./shared.js"

/** Query-only job persistence. This handle never starts a transaction. */
export const makeJobReadHandle = (
  database: ProductionDatabase
): JobReadHandle => {
  const findById = (jobId: string): string | undefined => {
    const row = selectJob(database).where(eq(episodeJobs.jobId, jobId)).get()
    return row === undefined ? undefined : documentOfJob(database, row)
  }

  const findOwned = (ownerId: string, jobId: string): string | undefined => {
    const row = selectJob(database)
      .where(
        and(eq(episodeJobs.ownerId, ownerId), eq(episodeJobs.jobId, jobId))
      )
      .get()
    return row === undefined ? undefined : documentOfJob(database, row)
  }

  return {
    findById,
    findOwned,
    listOwned: (ownerId, limit) =>
      selectJob(database)
        .where(eq(episodeJobs.ownerId, ownerId))
        .orderBy(desc(episodeJobs.createdAt), desc(episodeJobs.jobId))
        .limit(limit)
        .all()
        .map((row) => documentOfJob(database, row)),
    statusSnapshot: (): readonly SqliteJobStatusSnapshot[] =>
      database
        .select({
          status: episodeJobs.status,
          count: sql<number>`COUNT(*)`.as("count"),
          oldestActiveAt: sql<string | null>`MIN(
            CASE ${episodeJobs.status}
              WHEN 'Queued' THEN ${episodeJobs.enqueuedAt}
              WHEN 'Retrying' THEN ${episodeJobs.retryAt}
              WHEN 'Running' THEN ${episodeJobs.startedAt}
            END
          )`.as("oldestActiveAt"),
        })
        .from(episodeJobs)
        .groupBy(episodeJobs.status)
        .orderBy(asc(episodeJobs.status))
        .all()
        .map((row) => ({
          status: row.status.toLowerCase(),
          count: Number(row.count),
          ...(row.oldestActiveAt === null
            ? {}
            : { oldestActiveAt: row.oldestActiveAt }),
        })),
    listOwnedAgUiEvents: (input): readonly StoredJobAgUiEventRow[] =>
      database
        .select({
          sequence: episodeJobAguiEvents.sequence,
          payload: episodeJobAguiEvents.payload,
        })
        .from(episodeJobAguiEvents)
        .where(
          and(
            eq(episodeJobAguiEvents.ownerId, input.ownerId),
            eq(episodeJobAguiEvents.jobId, input.jobId),
            gt(episodeJobAguiEvents.sequence, input.afterSequence)
          )
        )
        .orderBy(asc(episodeJobAguiEvents.sequence))
        .limit(input.limit)
        .all(),
  }
}
