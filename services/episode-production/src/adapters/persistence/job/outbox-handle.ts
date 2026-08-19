import { and, asc, eq, isNull } from "drizzle-orm"

import {
  episodeCompletionOutbox,
  episodeJobs,
} from "../../../../drizzle/schema.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type { JobOutboxHandle, StoredCompletionOutboxRow } from "./ports.js"
import { leaseHolder, selectJob, writeJobDocument } from "./shared.js"

/** Atomic job completion and completion-event outbox persistence. */
export const makeJobOutboxHandle = (
  database: ProductionDatabase
): JobOutboxHandle => ({
  completeWithOutbox: (input) =>
    database.transaction((tx) => {
      const current = selectJob(tx)
        .where(eq(episodeJobs.jobId, input.jobId))
        .get()
      const existing = tx
        .select({
          episodeId: episodeCompletionOutbox.episodeId,
          payload: episodeCompletionOutbox.payload,
        })
        .from(episodeCompletionOutbox)
        .where(eq(episodeCompletionOutbox.jobId, input.jobId))
        .get()

      if (
        current?.status === "Succeeded" &&
        current.episodeId === input.episodeId &&
        existing?.episodeId === input.episodeId &&
        existing.payload === input.payload
      ) {
        return "Duplicate" as const
      }

      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return "StaleLease" as const
      }

      writeJobDocument(tx, input.jobId, input.document)
      tx.insert(episodeCompletionOutbox)
        .values({
          jobId: input.jobId,
          episodeId: input.episodeId,
          payload: input.payload,
          createdAt: input.createdAt,
          publishedAt: null,
        })
        .run()
      return "Applied" as const
    }),

  findCompletionOutbox: (jobId): StoredCompletionOutboxRow | undefined =>
    database
      .select({
        episodeId: episodeCompletionOutbox.episodeId,
        payload: episodeCompletionOutbox.payload,
      })
      .from(episodeCompletionOutbox)
      .where(eq(episodeCompletionOutbox.jobId, jobId))
      .get(),

  listPendingCompletionOutbox: (limit) =>
    database
      .select({
        jobId: episodeCompletionOutbox.jobId,
        episodeId: episodeCompletionOutbox.episodeId,
        payload: episodeCompletionOutbox.payload,
      })
      .from(episodeCompletionOutbox)
      .where(isNull(episodeCompletionOutbox.publishedAt))
      .orderBy(
        asc(episodeCompletionOutbox.createdAt),
        asc(episodeCompletionOutbox.jobId)
      )
      .limit(limit)
      .all(),

  markCompletionPublished: (jobId, publishedAt) =>
    Number(
      database
        .update(episodeCompletionOutbox)
        .set({ publishedAt })
        .where(
          and(
            eq(episodeCompletionOutbox.jobId, jobId),
            isNull(episodeCompletionOutbox.publishedAt)
          )
        )
        .run().changes
    ) === 1,
})
