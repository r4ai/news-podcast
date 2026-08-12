import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { sqliteJobRepository } from "./sqlite-job-repository.js"
import {
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
const job = (id: string, trigger: "manual" | "scheduled" = "manual") =>
  newQueuedJob({
    jobId: Schema.decodeUnknownSync(JobIdSchema)(id),
    ownerId: command.ownerId,
    idempotencyKey: command.idempotencyKey,
    trigger,
    enqueuedAt: at,
  })

describe("SQLite job repository", () => {
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
})
