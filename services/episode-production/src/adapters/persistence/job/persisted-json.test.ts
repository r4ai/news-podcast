import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { episodeGenerationPlans } from "../../../../drizzle/schema.js"
import {
  ArticleIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  LeaseTokenSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  newQueuedJob,
} from "../../../domain/episode-job.js"
import { openProductionDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { executionRepository } from "../execution/repository.js"
import { makeJobPlanHandle } from "./plan-handle.js"
import { makeJobProgressHandle } from "./progress-handle.js"
import { jobRepository } from "./repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => Schema.decodeUnknownSync(schema)(input)

const jobId = decode(JobIdSchema, "10e2d4e1-c127-479f-a124-2ea037bd9319")
const ownerId = decode(OwnerIdSchema, "owner-1")
const articleId = decode(
  ArticleIdSchema,
  "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
)
const leaseToken = decode(LeaseTokenSchema, "lease-1")
const at = decode(UtcTimestampSchema, "2026-08-20T00:00:00.000Z")

const preparePlan = async () => {
  const database = openProductionDatabaseUnsafe(":memory:")
  const commands = await Effect.runPromise(jobRepository(database.database))
  const execution = await Effect.runPromise(
    executionRepository(database.database)
  )
  await Effect.runPromise(
    commands.saveIdempotently(
      newQueuedJob({
        jobId,
        ownerId,
        idempotencyKey: decode(IdempotencyKeySchema, "persisted-json"),
        trigger: "manual",
        articleIds: [articleId],
        enqueuedAt: at,
      })
    )
  )
  await Effect.runPromise(
    execution.leaseNext({ now: at, leasedUntil: at, leaseToken })
  )
  await Effect.runPromise(
    execution.saveGenerationPlan({
      jobId,
      leaseToken,
      plan: {
        jobId,
        ownerId,
        selectionMode: "manual",
        interestProfile: { include: "", exclude: "" },
        selectedArticleIds: [articleId],
        model: "test",
        createdAt: at,
      },
    })
  )
  return database
}

describe("Episode Production persisted JSON", () => {
  it("accepts the legacy empty materialization and rejects a mismatched shape", async () => {
    const database = await preparePlan()
    const progress = makeJobProgressHandle(database.database)
    try {
      expect(
        progress.markStep({
          jobId,
          leaseToken,
          step: "selecting_articles",
          phase: "started",
          occurredAt: "2026-08-20T00:00:01.000Z",
        })
      ).toBe(true)

      database.database
        .update(episodeGenerationPlans)
        .set({ selectedArticles: "{}" })
        .where(eq(episodeGenerationPlans.jobId, jobId))
        .run()

      expect(() =>
        progress.markStep({
          jobId,
          leaseToken,
          step: "selecting_articles",
          phase: "finished",
          occurredAt: "2026-08-20T00:00:02.000Z",
        })
      ).toThrow()
    } finally {
      database.close()
    }
  })

  it("rejects legacy unbranded article IDs at the lower persistence boundary", async () => {
    const database = await preparePlan()
    try {
      database.database
        .update(episodeGenerationPlans)
        .set({ selectedArticleIds: '["legacy-id"]' })
        .where(eq(episodeGenerationPlans.jobId, jobId))
        .run()

      let failure: unknown
      try {
        makeJobPlanHandle(database.database).loadGenerationPlan(jobId)
      } catch (cause) {
        failure = cause
      }

      expect(failure).toEqual({
        _tag: "DatabaseFailed",
        operation: "episode_generation_plans.selected_article_ids",
        reason: "CorruptRecord",
      })
      expect(String(failure)).not.toContain("legacy-id")
    } finally {
      database.close()
    }
  })
})
