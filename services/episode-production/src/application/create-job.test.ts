import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { createJob } from "./create-job.js"
import {
  CreateJobCommandSchema,
  JobIdSchema,
  UtcTimestampSchema,
} from "../domain/episode-job.js"

describe("createJob", () => {
  it("builds and persists one immutable queued aggregate", async () => {
    const saved: unknown[] = []
    const useCase = createJob({
      nextJobId: Effect.succeed(
        Schema.decodeUnknownSync(JobIdSchema)(
          "10e2d4e1-c127-479f-a124-2ea037bd9319"
        )
      ),
      now: Effect.succeed(
        Schema.decodeUnknownSync(UtcTimestampSchema)("2026-08-12T00:00:00.000Z")
      ),
      saveIdempotently: (job) =>
        Effect.sync(() => saved.push(job)).pipe(Effect.as(job)),
    })

    const command = Schema.decodeUnknownSync(CreateJobCommandSchema)({
      ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
      idempotencyKey: "daily-2026-08-12",
      trigger: "manual",
      articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3a80"],
    })
    expect(command.articleIds).toBeDefined()

    const result = await Effect.runPromise(
      useCase({ ...command, articleIds: command.articleIds! })
    )

    expect(result._tag).toBe("Queued")
    expect(saved).toEqual([result])
    expect(Object.isFrozen(result)).toBe(true)
  })
})
