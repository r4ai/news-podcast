import { deepFreeze } from "@news-podcast/kernel"
import { decodePersistedJsonSync } from "@news-podcast/persistence"
import { and, asc, count, eq, gt, gte, inArray, lt, lte } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { archiveRefreshJobs as jobs } from "../../../../drizzle/schema.js"
import {
  ArchiveRefreshContextSchema,
  ArchiveRefreshJobSchema,
  type ArchiveRefreshFailure,
  type ArchiveRefreshQueue,
} from "../../../application/archive-refresh.js"
import { ArticleIdSchema } from "../../../domain/article.js"
import { OwnerIdSchema } from "../../../domain/subscription.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"

export const archiveRefreshLimits = Object.freeze({
  active: 32,
  ownerActive: 2,
  perMinute: 60,
  ownerPerMinute: 4,
  deadlineMillis: 120_000,
  retentionMillis: 86_400_000,
})
const failure = (
  reason: ArchiveRefreshFailure["reason"]
): ArchiveRefreshFailure => deepFreeze({ _tag: "ArchiveRefreshFailed", reason })
const active = inArray(jobs.status, ["queued", "processing"])
const publicJob = (row: typeof jobs.$inferSelect) =>
  Schema.decodeUnknownSync(ArchiveRefreshJobSchema)(row)

/** SQLite transactions enforce admission across every worker sharing this state. */
export const createArchiveRefreshQueue = (
  database: ContentKnowledgeDatabase,
  newJobId: () => string
): ArchiveRefreshQueue => {
  const expire = (tx: QueryRunner, now: string) => {
    tx.update(jobs)
      .set({ status: "failed", error: "deadline", completedAt: now })
      .where(and(active, lte(jobs.deadlineAt, now)))
      .run()
    tx.delete(jobs)
      .where(
        and(
          inArray(jobs.status, ["succeeded", "failed"]),
          lt(
            jobs.createdAt,
            new Date(
              Date.parse(now) - archiveRefreshLimits.retentionMillis
            ).toISOString()
          )
        )
      )
      .run()
  }
  const guarded = <A>(run: () => A) =>
    Effect.try({
      try: run,
      catch: (error) =>
        typeof error === "object" &&
        error !== null &&
        "_tag" in error &&
        error._tag === "ArchiveRefreshFailed"
          ? (error as ArchiveRefreshFailure)
          : failure("storage"),
    })
  return deepFreeze({
    stats: () =>
      guarded(() => ({
        queued:
          database
            .select({ value: count() })
            .from(jobs)
            .where(eq(jobs.status, "queued"))
            .get()?.value ?? 0,
        processing:
          database
            .select({ value: count() })
            .from(jobs)
            .where(eq(jobs.status, "processing"))
            .get()?.value ?? 0,
        expired:
          database
            .select({ value: count() })
            .from(jobs)
            .where(and(eq(jobs.status, "failed"), eq(jobs.error, "deadline")))
            .get()?.value ?? 0,
      })),
    enqueue: (input, now) =>
      guarded(() =>
        database.transaction(
          (tx) => {
            expire(tx, now)
            const existing = tx
              .select()
              .from(jobs)
              .where(
                and(
                  active,
                  eq(jobs.ownerId, input.ownerId),
                  eq(jobs.articleId, input.articleId)
                )
              )
              .get()
            if (existing !== undefined)
              return { job: publicJob(existing), reused: true }
            const activeRows = tx
              .select({ ownerId: jobs.ownerId })
              .from(jobs)
              .where(active)
              .all()
            if (
              activeRows.length >= archiveRefreshLimits.active ||
              activeRows.filter((row) => row.ownerId === input.ownerId)
                .length >= archiveRefreshLimits.ownerActive
            )
              throw failure("capacity")
            const since = new Date(Date.parse(now) - 60_000).toISOString()
            const recent = tx
              .select({ ownerId: jobs.ownerId })
              .from(jobs)
              .where(gte(jobs.createdAt, since))
              .all()
            if (
              recent.length >= archiveRefreshLimits.perMinute ||
              recent.filter((row) => row.ownerId === input.ownerId).length >=
                archiveRefreshLimits.ownerPerMinute
            )
              throw failure("rate")
            const row = tx
              .insert(jobs)
              .values({
                jobId: newJobId(),
                ownerId: input.ownerId,
                articleId: input.articleId,
                contextJson: JSON.stringify(input.context),
                status: "queued",
                createdAt: now,
                deadlineAt: new Date(
                  Date.parse(now) + archiveRefreshLimits.deadlineMillis
                ).toISOString(),
              })
              .returning()
              .get()
            return { job: publicJob(row), reused: false }
          },
          { behavior: "immediate" }
        )
      ),
    find: (ownerId, articleId, jobId, now) =>
      guarded(() =>
        database.transaction((tx) => {
          expire(tx, now)
          const row = tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.ownerId, ownerId),
                eq(jobs.articleId, articleId),
                eq(jobs.jobId, jobId)
              )
            )
            .get()
          return row === undefined ? undefined : publicJob(row)
        })
      ),
    claim: (now) =>
      guarded(() =>
        database.transaction(
          (tx) => {
            expire(tx, now)
            // One global capture, including across replicas; never reassign processing work.
            if (
              (tx
                .select({ value: count() })
                .from(jobs)
                .where(eq(jobs.status, "processing"))
                .get()?.value ?? 0) > 0
            )
              return undefined
            const next = tx
              .select()
              .from(jobs)
              .where(eq(jobs.status, "queued"))
              .orderBy(asc(jobs.createdAt), asc(jobs.jobId))
              .limit(1)
              .get()
            if (next === undefined) return undefined
            const row = tx
              .update(jobs)
              .set({ status: "processing" })
              .where(and(eq(jobs.jobId, next.jobId), eq(jobs.status, "queued")))
              .returning()
              .get()
            return {
              job: publicJob(row),
              ownerId: Schema.decodeUnknownSync(OwnerIdSchema)(row.ownerId),
              articleId: Schema.decodeUnknownSync(ArticleIdSchema)(
                row.articleId
              ),
              context: decodePersistedJsonSync(
                "ArchiveRefreshClaim",
                ArchiveRefreshContextSchema,
                row.contextJson
              ),
              deadlineAt: row.deadlineAt,
            }
          },
          { behavior: "immediate" }
        )
      ),
    complete: (jobId, error, now) =>
      guarded(() => {
        // A deadline-expired or canceled receipt cannot be revived by late completion.
        database
          .update(jobs)
          .set({
            status: error === null ? "succeeded" : "failed",
            error,
            completedAt: now,
          })
          .where(
            and(
              eq(jobs.jobId, jobId),
              eq(jobs.status, "processing"),
              gt(jobs.deadlineAt, now)
            )
          )
          .run()
      }),
  })
}
