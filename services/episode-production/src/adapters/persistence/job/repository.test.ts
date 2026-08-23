import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { jobRepository } from "./repository.js"
import { executionRepository } from "../execution/repository.js"
import { openProductionDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  ArticleIdSchema,
  LeaseTokenSchema,
  CreateJobCommandSchema,
  JobIdSchema,
  failRunningJob,
  newQueuedJob,
  UtcTimestampSchema,
} from "../../../domain/episode-job.js"

const command = Schema.decodeUnknownSync(CreateJobCommandSchema)({
  ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
  idempotencyKey: "daily-2026-08-12",
  trigger: "manual",
})
const at = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-12T00:00:00.000Z"
)
const later = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-12T01:00:00.000Z"
)
const job = (
  id: string,
  trigger: "manual" | "scheduled" = "manual",
  articleIds?: readonly string[],
  idempotencyKey: string = command.idempotencyKey,
  enqueuedAt = at
) =>
  newQueuedJob({
    jobId: Schema.decodeUnknownSync(JobIdSchema)(id),
    ownerId: command.ownerId,
    idempotencyKey: Schema.decodeUnknownSync(CreateJobCommandSchema)({
      ...command,
      idempotencyKey,
    }).idempotencyKey,
    trigger,
    ...(articleIds === undefined
      ? {}
      : {
          articleIds: articleIds.map((id) =>
            Schema.decodeUnknownSync(ArticleIdSchema)(id)
          ),
        }),
    enqueuedAt,
  })

describe("SQLite job repository", () => {
  it("observes accepted, replay, and conflict without exposing the key", async () => {
    const observations: unknown[] = []
    const first = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const replay = job("6518412b-ce2f-4641-9f2c-a02dd515bc31")
    const conflict = job("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80", "scheduled")
    const retrySourceId = first.jobId
    const firstRetry = job(
      "a7ad9b42-2aa7-48d6-b3fe-f0035e4ff879",
      "manual",
      undefined,
      "retry-key"
    )
    const retryReplay = job(
      "b3a605e7-eb36-4994-81c1-a5ac6de414f3",
      "manual",
      undefined,
      "retry-key"
    )
    const retryConflict = job(
      "fe6a7e1d-fd67-4e94-84e8-36f566df972d",
      "scheduled",
      undefined,
      "retry-key"
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(":memory:").database,
            (observation) =>
              Effect.sync(() => void observations.push(observation))
          )
          yield* repository.saveIdempotently(first)
          yield* repository.saveIdempotently(replay)
          yield* repository.saveIdempotently(conflict).pipe(Effect.ignore)
          yield* repository.saveRetryIdempotently(retrySourceId, firstRetry)
          yield* repository.saveRetryIdempotently(retrySourceId, retryReplay)
          yield* repository
            .saveRetryIdempotently(retrySourceId, retryConflict)
            .pipe(Effect.ignore)
        })
      )
    )

    expect(observations).toEqual([
      { operation: "create", outcome: "accepted" },
      { operation: "create", outcome: "replay" },
      { operation: "create", outcome: "conflict" },
      { operation: "retry", outcome: "accepted" },
      { operation: "retry", outcome: "replay" },
      { operation: "retry", outcome: "conflict" },
    ])
    expect(JSON.stringify(observations)).not.toContain(command.idempotencyKey)
    expect(JSON.stringify(observations)).not.toContain("retry-key")
  })

  it("reports job-state counts and the oldest active timestamp", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(":memory:").database
          )
          yield* repository.saveIdempotently(
            job("10e2d4e1-c127-479f-a124-2ea037bd9319")
          )
          yield* repository.saveIdempotently(
            job(
              "6518412b-ce2f-4641-9f2c-a02dd515bc31",
              "manual",
              undefined,
              "daily-2026-08-12-second"
            )
          )
          return yield* repository.statusSnapshot()
        })
      )
    )

    expect(result).toEqual([
      {
        status: "queued",
        count: 2,
        oldestActiveAt: "2026-08-12T00:00:00.000Z",
      },
    ])
  })

  it("reports a running job as ready at lease expiry, not start time", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(":memory:").database
          const repository = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* repository.saveIdempotently(
            job("10e2d4e1-c127-479f-a124-2ea037bd9319")
          )
          yield* execution.leaseNext({
            now: at,
            leasedUntil: later,
            leaseToken: Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1"),
          })
          return yield* repository.statusSnapshot()
        })
      )
    )

    expect(result).toEqual([
      {
        status: "running",
        count: 1,
        oldestActiveAt: "2026-08-12T01:00:00.000Z",
      },
    ])
  })

  it("returns the original immutable job for an idempotent replay", async () => {
    const original = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const replay = job("6518412b-ce2f-4641-9f2c-a02dd515bc31")

    const [saved, repeated] = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          const saved = yield* repository.saveIdempotently(original)
          const repeated = yield* repository.saveIdempotently(replay)
          return [saved, repeated] as const
        })
      )
    )

    expect(saved.jobId).toBe(original.jobId)
    expect(repeated.jobId).toBe(original.jobId)
    expect(Object.isFrozen(repeated)).toBe(true)
  })

  it("separates retry idempotency from creation for the same client key", async () => {
    const original = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const retried = job("6518412b-ce2f-4641-9f2c-a02dd515bc31")

    const savedRetry = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(":memory:").database
          )
          yield* repository.saveIdempotently(original)
          return yield* repository.saveRetryIdempotently(
            original.jobId,
            retried
          )
        })
      )
    )

    expect(savedRetry).toMatchObject({
      _tag: "Queued",
      jobId: retried.jobId,
    })
  })

  it("replays a terminal job without narrowing it to queued", async () => {
    const source = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const firstRetry = job("6518412b-ce2f-4641-9f2c-a02dd515bc31")
    const replay = job("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80")
    const leaseToken = Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1")

    const repeated = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(":memory:").database
          const repository = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* repository.saveRetryIdempotently(source.jobId, firstRetry)
          const leased = yield* execution.leaseNext({
            now: at,
            leasedUntil: at,
            leaseToken,
          })
          if (leased?.job._tag !== "Running") {
            return yield* Effect.die("expected a running lease")
          }
          yield* execution.transition({
            jobId: firstRetry.jobId,
            leaseToken,
            state: failRunningJob(leased.job, {
              failedAt: at,
              failure: {
                code: "script_timeout",
                retryable: false,
              },
            }),
          })
          return yield* repository.saveRetryIdempotently(source.jobId, replay)
        })
      )
    )

    expect(repeated).toMatchObject({
      _tag: "Failed",
      jobId: firstRetry.jobId,
      failure: { code: "script_timeout" },
    })
  })

  it("rejects reuse of a key for a different request", async () => {
    const first = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const conflict = job("6518412b-ce2f-4641-9f2c-a02dd515bc31", "scheduled")

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          return yield* repository
            .saveIdempotently(first)
            .pipe(Effect.andThen(repository.saveIdempotently(conflict)))
        })
      )
    )

    expect(exit._tag).toBe("Failure")
  })

  it("keeps the first scheduled snapshot when schedule completion is retried", async () => {
    const first = job(
      "10e2d4e1-c127-479f-a124-2ea037bd9319",
      "scheduled",
      ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
      "scheduled:owner:2026-08-15"
    )
    const changed = job(
      "6518412b-ce2f-4641-9f2c-a02dd515bc31",
      "scheduled",
      ["3c4d046c-b47b-4047-a562-66ac7e74e995"],
      "scheduled:owner:2026-08-15"
    )

    const repeated = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          yield* repository.saveScheduledIdempotently(first)
          return yield* repository.saveScheduledIdempotently(changed)
        })
      )
    )

    expect(repeated.jobId).toBe(first.jobId)
    expect(repeated.request.articleIds).toEqual(first.request.articleIds)
  })

  it("requeues a candidate-missed scheduled job after a service restart", async () => {
    const databasePath = join(
      mkdtempSync(join(tmpdir(), "episode-production-schedule-")),
      "jobs.sqlite"
    )
    const scheduled = job(
      "10e2d4e1-c127-479f-a124-2ea037bd9319",
      "scheduled",
      undefined,
      "scheduled:owner:2026-08-15"
    )
    const leaseToken = Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1")
    const first = openProductionDatabaseUnsafe(databasePath)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* jobRepository(first.database)
          const execution = yield* executionRepository(first.database)
          yield* repository.saveScheduledIdempotently(scheduled)
          const leased = yield* execution.leaseNext({
            now: at,
            leasedUntil: at,
            leaseToken,
          })
          if (leased?.job._tag !== "Running") {
            return yield* Effect.die("expected a running lease")
          }
          yield* execution.transition({
            jobId: scheduled.jobId,
            leaseToken,
            state: failRunningJob(leased.job, {
              failedAt: at,
              failure: {
                code: "no_generation_candidates" as never,
                retryable: false,
              },
            }),
          })
        })
      )
    } finally {
      first.close()
    }

    const restarted = openProductionDatabaseUnsafe(databasePath)
    try {
      const requeued = await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* jobRepository(restarted.database)
          return yield* repository.saveScheduledIdempotently(
            job(
              "6518412b-ce2f-4641-9f2c-a02dd515bc31",
              "scheduled",
              undefined,
              "scheduled:owner:2026-08-15",
              later
            )
          )
        })
      )

      expect(requeued).toMatchObject({
        _tag: "Queued",
        jobId: scheduled.jobId,
        attempt: 0,
        createdAt: later,
        enqueuedAt: later,
      })
    } finally {
      restarted.close()
    }
  })

  it("treats selected articles as an order-independent idempotency input", async () => {
    const first = job("10e2d4e1-c127-479f-a124-2ea037bd9319", "manual", [
      "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      "3c4d046c-b47b-4047-a562-66ac7e74e995",
    ])
    const reordered = job("6518412b-ce2f-4641-9f2c-a02dd515bc31", "manual", [
      "3c4d046c-b47b-4047-a562-66ac7e74e995",
      "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    ])

    const repeated = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          yield* repository.saveIdempotently(first)
          return yield* repository.saveIdempotently(reordered)
        })
      )
    )

    expect(repeated.jobId).toBe(first.jobId)
  })

  it("rejects reuse of an automatic-selection key for explicit articles", async () => {
    const automatic = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const selected = job("6518412b-ce2f-4641-9f2c-a02dd515bc31", "manual", [
      "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    ])

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          yield* repository.saveIdempotently(automatic)
          return yield* repository.saveIdempotently(selected)
        })
      )
    )

    expect(exit._tag).toBe("Failure")
  })

  it("parses persisted JSON before returning it to the application", async () => {
    const original = job("10e2d4e1-c127-479f-a124-2ea037bd9319")

    const loaded = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(
              join(
                mkdtempSync(join(tmpdir(), "episode-production-")),
                "jobs.sqlite"
              )
            ).database
          )
          return yield* repository
            .saveIdempotently(original)
            .pipe(Effect.andThen(repository.findById(original.jobId)))
        })
      )
    )

    expect(loaded).toEqual(original)
    expect(loaded && Object.isFrozen(loaded.request)).toBe(true)
  })

  it("lists and finds jobs only inside the authenticated owner scope", async () => {
    const ownerOneFirst = job(
      "10e2d4e1-c127-479f-a124-2ea037bd9319",
      "manual",
      undefined,
      "owner-1-first"
    )
    const ownerOneSecond = job(
      "6518412b-ce2f-4641-9f2c-a02dd515bc31",
      "manual",
      undefined,
      "owner-1-second"
    )
    const ownerTwoCommand = Schema.decodeUnknownSync(CreateJobCommandSchema)({
      ...command,
      ownerId: "owner-2",
      idempotencyKey: "owner-2-key",
    })
    const ownerTwo = newQueuedJob({
      jobId: Schema.decodeUnknownSync(JobIdSchema)(
        "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
      ),
      ownerId: ownerTwoCommand.ownerId,
      idempotencyKey: ownerTwoCommand.idempotencyKey,
      trigger: "manual",
      enqueuedAt: at,
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* jobRepository(
            openProductionDatabaseUnsafe(":memory:").database
          )
          yield* repository.saveIdempotently(ownerOneFirst)
          yield* repository.saveIdempotently(ownerOneSecond)
          yield* repository.saveIdempotently(ownerTwo)
          return {
            ownerOne: yield* repository.listOwned(command.ownerId, 100),
            hidden: yield* repository.findOwned(
              command.ownerId,
              ownerTwo.jobId
            ),
          }
        })
      )
    )

    expect(result.ownerOne.map((entry) => entry.jobId)).toEqual([
      ownerOneSecond.jobId,
      ownerOneFirst.jobId,
    ])
    expect(result.hidden).toBeUndefined()
  })

  it("atomically cancels only active jobs and fences an active lease", async () => {
    const queued = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const token = Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1")
    const ownerTwo = Schema.decodeUnknownSync(CreateJobCommandSchema)({
      ...command,
      ownerId: "owner-2",
    }).ownerId
    const databasePath = join(
      mkdtempSync(join(tmpdir(), "episode-production-control-")),
      "jobs.sqlite"
    )

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(databasePath).database
          const repository = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* repository.saveIdempotently(queued)
          yield* execution.leaseNext({
            now: at,
            leasedUntil: Schema.decodeUnknownSync(UtcTimestampSchema)(
              "2026-08-12T00:01:00.000Z"
            ),
            leaseToken: token,
          })
          const hidden = yield* repository.cancelOwned(
            ownerTwo,
            queued.jobId,
            at
          )
          const canceled = yield* repository.cancelOwned(
            command.ownerId,
            queued.jobId,
            at
          )
          const terminal = yield* repository.cancelOwned(
            command.ownerId,
            queued.jobId,
            at
          )
          const leaseExit = yield* Effect.exit(
            execution.assertLease({ jobId: queued.jobId, leaseToken: token })
          )
          const cancellation = yield* execution.checkCancellation({
            jobId: queued.jobId,
            leaseToken: token,
          })
          const events = yield* repository.listOwnedAgUiEvents({
            ownerId: command.ownerId,
            jobId: queued.jobId,
            afterSequence: 0,
            limit: 100,
          })
          const resumed = yield* repository.listOwnedAgUiEvents({
            ownerId: command.ownerId,
            jobId: queued.jobId,
            afterSequence: events[2]!.sequence,
            limit: 100,
          })
          return {
            hidden,
            canceled,
            terminal,
            leaseExit,
            cancellation,
            events,
            resumed,
          }
        })
      )
    )

    expect(result.hidden).toEqual({ _tag: "NotFound" })
    expect(result.canceled).toMatchObject({
      _tag: "Canceled",
      job: { _tag: "Canceled", reason: "requested_by_user" },
    })
    expect(result.terminal).toEqual({ _tag: "Terminal" })
    expect(result.leaseExit._tag).toBe("Failure")
    expect(result.cancellation).toMatchObject({
      _tag: "Canceled",
      canceledAt: at,
    })
    expect(
      result.events.map((event) => (event.event as { type: string }).type)
    ).toEqual([
      "STATE_SNAPSHOT",
      "RUN_STARTED",
      "STATE_SNAPSHOT",
      "RUN_ERROR",
      "STATE_SNAPSHOT",
    ])
    expect(
      result.resumed.map((event) => (event.event as { type: string }).type)
    ).toEqual(["RUN_ERROR", "STATE_SNAPSHOT"])
  })
})
