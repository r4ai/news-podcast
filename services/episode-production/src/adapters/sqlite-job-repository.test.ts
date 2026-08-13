import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { sqliteJobRepository } from "./sqlite-job-repository.js"
import { sqliteExecutionRepository } from "./sqlite-execution-repository.js"
import { openSqliteJobHandle } from "../infrastructure/unsafe/sqlite.js"
import {
  ArticleIdSchema,
  LeaseTokenSchema,
  CreateJobCommandSchema,
  JobIdSchema,
  newQueuedJob,
  UtcTimestampSchema,
} from "../domain/episode-job.js"

const command = Schema.decodeUnknownSync(CreateJobCommandSchema)({
  ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
  idempotencyKey: "daily-2026-08-12",
  trigger: "manual",
})
const at = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-12T00:00:00.000Z"
)
const job = (
  id: string,
  trigger: "manual" | "scheduled" = "manual",
  articleIds?: readonly string[],
  idempotencyKey: string = command.idempotencyKey
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
    enqueuedAt: at,
  })

describe("SQLite job repository", () => {
  it("backfills the original queued timestamp into legacy state documents", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "episode-production-migration-")),
      "jobs.sqlite"
    )
    const database = new DatabaseSync(path)
    database.exec(`
      CREATE TABLE episode_jobs (
        job_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        document TEXT NOT NULL,
        UNIQUE(owner_id, idempotency_key)
      ) STRICT;
      CREATE TABLE episode_job_status_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES episode_jobs(job_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        document TEXT NOT NULL
      ) STRICT;
    `)
    const queuedDocument = JSON.stringify({
      _tag: "Queued",
      enqueuedAt: "2026-08-12T00:00:00.000Z",
    })
    const runningDocument = JSON.stringify({
      _tag: "Running",
      startedAt: "2026-08-12T00:05:00.000Z",
    })
    database
      .prepare("INSERT INTO episode_jobs VALUES (?, ?, ?, ?, ?)")
      .run("legacy-job", "owner", "key", "fingerprint", runningDocument)
    database
      .prepare(
        "INSERT INTO episode_job_status_events(job_id, owner_id, document) VALUES (?, ?, ?)"
      )
      .run("legacy-job", "owner", queuedDocument)
    database
      .prepare(
        "INSERT INTO episode_job_status_events(job_id, owner_id, document) VALUES (?, ?, ?)"
      )
      .run("legacy-job", "owner", runningDocument)
    database.close()

    const handle = openSqliteJobHandle(path)
    try {
      expect(JSON.parse(handle.findById("legacy-job")!)).toMatchObject({
        createdAt: "2026-08-12T00:00:00.000Z",
      })
      expect(
        handle
          .listOwnedStatusEvents({
            ownerId: "owner",
            jobId: "legacy-job",
            afterSequence: 0,
            limit: 10,
          })
          .map(({ document }) => JSON.parse(document).createdAt)
      ).toEqual(["2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z"])
    } finally {
      handle.close()
    }
  })

  it("returns the original immutable job for an idempotent replay", async () => {
    const original = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const replay = job("6518412b-ce2f-4641-9f2c-a02dd515bc31")

    const [saved, repeated] = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* sqliteJobRepository(
            join(
              mkdtempSync(join(tmpdir(), "episode-production-")),
              "jobs.sqlite"
            )
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

  it("rejects reuse of a key for a different request", async () => {
    const first = job("10e2d4e1-c127-479f-a124-2ea037bd9319")
    const conflict = job("6518412b-ce2f-4641-9f2c-a02dd515bc31", "scheduled")

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* sqliteJobRepository(
            join(
              mkdtempSync(join(tmpdir(), "episode-production-")),
              "jobs.sqlite"
            )
          )
          return yield* repository
            .saveIdempotently(first)
            .pipe(Effect.andThen(repository.saveIdempotently(conflict)))
        })
      )
    )

    expect(exit._tag).toBe("Failure")
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
          const repository = yield* sqliteJobRepository(
            join(
              mkdtempSync(join(tmpdir(), "episode-production-")),
              "jobs.sqlite"
            )
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
          const repository = yield* sqliteJobRepository(
            join(
              mkdtempSync(join(tmpdir(), "episode-production-")),
              "jobs.sqlite"
            )
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
          const repository = yield* sqliteJobRepository(
            join(
              mkdtempSync(join(tmpdir(), "episode-production-")),
              "jobs.sqlite"
            )
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
          const repository = yield* sqliteJobRepository(":memory:")
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
          const repository = yield* sqliteJobRepository(databasePath)
          const execution = yield* sqliteExecutionRepository(databasePath)
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
          const events = yield* repository.listOwnedStatusEvents({
            ownerId: command.ownerId,
            jobId: queued.jobId,
            afterSequence: 0,
            limit: 100,
          })
          const resumed = yield* repository.listOwnedStatusEvents({
            ownerId: command.ownerId,
            jobId: queued.jobId,
            afterSequence: events[1]!.sequence,
            limit: 100,
          })
          return { hidden, canceled, terminal, leaseExit, events, resumed }
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
    expect(result.events.map((event) => event.job._tag)).toEqual([
      "Queued",
      "Running",
      "Canceled",
    ])
    expect(result.resumed.map((event) => event.job._tag)).toEqual(["Canceled"])
  })
})
