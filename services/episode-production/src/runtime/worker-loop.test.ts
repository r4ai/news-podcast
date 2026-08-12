import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  IdempotencyKeySchema,
  JobIdSchema,
  LeaseTokenSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  leaseQueuedJob,
  newQueuedJob,
} from "../domain/episode-job.js"
import {
  runEpisodeWorkerLoop,
  type EpisodeWorkerEvent,
  type EpisodeWorkerPorts,
} from "./worker-loop.js"

const at = (value: string) =>
  Schema.decodeUnknownSync(UtcTimestampSchema)(value)
const leaseToken = Schema.decodeUnknownSync(LeaseTokenSchema)("lease")
const job = leaseQueuedJob(
  newQueuedJob({
    jobId: Schema.decodeUnknownSync(JobIdSchema)(
      "10e2d4e1-c127-479f-a124-2ea037bd9319"
    ),
    ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-1"),
    idempotencyKey: Schema.decodeUnknownSync(IdempotencyKeySchema)("daily"),
    trigger: "manual",
    enqueuedAt: at("2026-08-13T00:00:00.000Z"),
  }),
  {
    token: leaseToken,
    startedAt: at("2026-08-13T00:01:00.000Z"),
    leasedUntil: at("2026-08-13T00:06:00.000Z"),
  }
)

describe("episode worker loop", () => {
  it("backs off while idle, resets after work, and reports typed outcomes", async () => {
    const controller = new AbortController()
    const events: EpisodeWorkerEvent[] = []
    const waits: number[] = []
    const leases = [undefined, { job, recovered: true }, undefined] as const
    let leaseIndex = 0
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed(leases[leaseIndex++]),
      execute: () => Effect.succeed({ _tag: "Succeeded" }),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      backoffMillis: (idle) => idle * 100,
      wait: (delay) =>
        Effect.sync(() => {
          waits.push(delay)
          if (waits.length === 2) controller.abort()
        }),
      observe: (event) => Effect.sync(() => events.push(event)),
    }

    await Effect.runPromise(runEpisodeWorkerLoop(ports, controller.signal))

    expect(waits).toEqual([100, 100])
    expect(events).toEqual([
      { _tag: "WorkerIdle", consecutiveIdle: 1, waitMillis: 100 },
      {
        _tag: "JobLeased",
        jobId: job.jobId,
        attempt: 1,
        recovered: true,
      },
      { _tag: "JobFinished", jobId: job.jobId, outcome: "Succeeded" },
      { _tag: "WorkerIdle", consecutiveIdle: 1, waitMillis: 100 },
      { _tag: "WorkerStopped" },
    ])
  })

  it("reports an execution infrastructure failure before supervision takes over", async () => {
    const controller = new AbortController()
    const events: EpisodeWorkerEvent[] = []
    const failure = {
      _tag: "PipelineFailure" as const,
      code: "sqlite_transition",
      retryable: true,
    }
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed({ job, recovered: false }),
      execute: () => Effect.fail(failure),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      backoffMillis: () => 100,
      wait: () => Effect.void,
      observe: (event) => Effect.sync(() => events.push(event)),
    }

    const exit = await Effect.runPromiseExit(
      runEpisodeWorkerLoop(ports, controller.signal)
    )

    expect(exit._tag).toBe("Failure")
    expect(events.at(-1)).toEqual({
      _tag: "WorkerFailed",
      stage: "execute",
      jobId: job.jobId,
      code: "sqlite_transition",
      retryable: true,
    })
  })

  it("reports a lease infrastructure failure without invoking execution", async () => {
    const controller = new AbortController()
    const events: EpisodeWorkerEvent[] = []
    let executions = 0
    const failure = {
      _tag: "PipelineFailure" as const,
      code: "sqlite_lease_next",
      retryable: true,
    }
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.fail(failure),
      execute: () =>
        Effect.sync(() => {
          executions += 1
          return { _tag: "Succeeded" as const }
        }),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      backoffMillis: () => 100,
      wait: () => Effect.void,
      observe: (event) => Effect.sync(() => events.push(event)),
    }

    const exit = await Effect.runPromiseExit(
      runEpisodeWorkerLoop(ports, controller.signal)
    )

    expect(exit._tag).toBe("Failure")
    expect(executions).toBe(0)
    expect(events).toEqual([
      {
        _tag: "WorkerFailed",
        stage: "lease",
        code: "sqlite_lease_next",
        retryable: true,
      },
    ])
  })
})
