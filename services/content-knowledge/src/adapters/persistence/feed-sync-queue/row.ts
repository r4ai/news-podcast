import { deepFreeze, parse } from "@news-podcast/kernel"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { feedCatalog, feedSyncJobs } from "../../../../drizzle/schema.js"
import type { FeedSyncQueueError } from "../../../application/feed-sync-queue.js"
import {
  FeedSyncJobSchema,
  SyncJobIdSchema,
} from "../../../domain/feed-sync.js"
import { Sha256Schema } from "../../../domain/article.js"
import { FeedIdSchema, FeedUrlSchema } from "../../../domain/subscription.js"
import type { QueryRunner } from "../../../infrastructure/unsafe/drizzle/open.js"

export const FEED_SYNC_MAX_ATTEMPTS = 4

const RowSchema = Schema.Struct({
  jobId: Schema.String,
  feedId: Schema.String,
  feedUrl: Schema.String,
  status: Schema.String,
  attempt: Schema.Int,
  leaseToken: Schema.NullOr(Schema.String),
  readyAt: Schema.optional(Schema.String),
  continuationJson: Schema.optional(Schema.NullOr(Schema.String)),
  discovered: Schema.Int,
  archived: Schema.Int,
  failed: Schema.Int,
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})
const parseRow = parse(RowSchema)

export const failure = (
  operation: FeedSyncQueueError["operation"],
  reason: FeedSyncQueueError["reason"] = "Unavailable"
): FeedSyncQueueError =>
  deepFreeze({ _tag: "FeedSyncQueueFailed", operation, reason })

export const jobProjection = {
  jobId: feedSyncJobs.jobId,
  feedId: feedSyncJobs.feedId,
  feedUrl: feedCatalog.feedUrl,
  status: feedSyncJobs.status,
  attempt: feedSyncJobs.attempt,
  leaseToken: feedSyncJobs.leaseToken,
  continuationJson: feedSyncJobs.continuationJson,
  readyAt: feedSyncJobs.readyAt,
  discovered: feedSyncJobs.discovered,
  archived: feedSyncJobs.archived,
  failed: feedSyncJobs.failed,
  error: feedSyncJobs.error,
  createdAt: feedSyncJobs.createdAt,
  startedAt: feedSyncJobs.startedAt,
  completedAt: feedSyncJobs.completedAt,
}

export const selectJobs = (runner: QueryRunner) =>
  runner
    .select(jobProjection)
    .from(feedSyncJobs)
    .innerJoin(feedCatalog, eq(feedCatalog.feedId, feedSyncJobs.feedId))

/**
 * NULL列は「キーが無い」形へ畳んでからドメインへ渡す。
 * 試行上限はテーブルではなくドメインの規則なので、ここで合流させる。
 */
export const decodeJob = (
  row: unknown,
  operation: FeedSyncQueueError["operation"]
) =>
  parseRow(row).pipe(
    Effect.flatMap((value) => {
      const {
        error,
        leaseToken: _leaseToken,
        continuationJson: _continuationJson,
        readyAt: _readyAt,
        startedAt,
        completedAt,
        ...required
      } = value
      return Effect.all([
        parse(SyncJobIdSchema)(value.jobId),
        parse(FeedIdSchema)(value.feedId),
        parse(FeedUrlSchema)(value.feedUrl),
        parse(FeedSyncJobSchema)({
          ...required,
          maxAttempts: FEED_SYNC_MAX_ATTEMPTS,
          ...(error === null ? {} : { error }),
          ...(startedAt === null ? {} : { startedAt }),
          ...(completedAt === null ? {} : { completedAt }),
        }),
      ]).pipe(
        Effect.map(([jobId, feedId, feedUrl, job]) =>
          deepFreeze({ ...job, jobId, feedId, feedUrl })
        )
      )
    }),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const decodeClaimedJob = (
  row: unknown,
  operation: FeedSyncQueueError["operation"]
) =>
  parseRow(row).pipe(
    Effect.flatMap((value) => {
      const leaseToken = value.leaseToken
      return leaseToken === null
        ? Effect.fail(failure(operation, "CorruptRecord"))
        : decodeJob(row, operation).pipe(
            Effect.flatMap((job) =>
              value.continuationJson == null
                ? Effect.succeed(
                    deepFreeze({
                      ...job,
                      readyAt: value.readyAt || job.createdAt,
                      leaseToken,
                    })
                  )
                : parse(Schema.fromJsonString(ContinuationSchema))(
                    value.continuationJson
                  ).pipe(
                    Effect.map((continuation) =>
                      deepFreeze({
                        ...job,
                        readyAt: value.readyAt || job.createdAt,
                        leaseToken,
                        continuation,
                      })
                    )
                  )
            )
          )
    }),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const ContinuationSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      externalId: Schema.String,
      captureFingerprint: Sha256Schema,
      title: Schema.String,
      url: Schema.String,
      publishedAt: Schema.optional(Schema.String),
    })
  ).check(Schema.isMaxLength(1_000)),
  failures: Schema.Array(
    Schema.Struct({
      _tag: Schema.Literal("FeedItemValidationFailed"),
      reason: Schema.Literals([
        "InvalidItem",
        "InvalidUrl",
        "MissingLink",
        "MissingTitle",
        "TitleTooLong",
      ]),
    })
  ).check(Schema.isMaxLength(1_000)),
})
