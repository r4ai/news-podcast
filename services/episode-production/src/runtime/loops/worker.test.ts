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
} from "../../domain/episode-job.js"
import {
  MAX_CANCELLATION_POLL_MILLIS,
  episodeJobDeadlineAt,
  runEpisodeWorkerLoop,
  type CancellationPropagation,
  type EpisodeWorkerEvent,
  type EpisodeWorkerPorts,
} from "./worker.js"
import { makeJobCancellationRegistry } from "../job-cancellation-registry.js"

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
  it("derives one immutable thirty-minute deadline from job creation", () => {
    expect(episodeJobDeadlineAt(at("2026-08-13T00:00:00.000Z"))).toBe(
      "2026-08-13T00:30:00.000Z"
    )
  })

  it("passes an already-aborted deadline signal to overdue execution", async () => {
    const controller = new AbortController()
    let deadlineReason: unknown
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed({ job, recovered: false }),
      renewLease: () => Effect.succeed("Applied"),
      execute: ({ signal }) =>
        Effect.sync(() => {
          deadlineReason = signal?.reason
          return {
            _tag: "Failed" as const,
            failureCode: "job_deadline_exceeded",
          }
        }),
      now: () => at("2026-08-13T00:31:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:36:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 20,
      backoffMillis: () => 100,
      wait: () => Effect.void,
      observe: (event) =>
        Effect.sync(() => {
          if (event._tag === "JobFinished") controller.abort()
        }),
    }

    await Effect.runPromise(runEpisodeWorkerLoop(ports, controller.signal))

    expect(deadlineReason).toBe("job_deadline_exceeded")
  })
  it("backs off while idle, resets after work, and reports typed outcomes", async () => {
    const controller = new AbortController()
    const events: EpisodeWorkerEvent[] = []
    const waits: number[] = []
    const leases = [undefined, { job, recovered: true }, undefined] as const
    let leaseIndex = 0
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed(leases[leaseIndex++]),
      renewLease: () => Effect.succeed("Applied"),
      execute: () => Effect.succeed({ _tag: "Succeeded" }),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 20,
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
      {
        _tag: "JobFinished",
        jobId: job.jobId,
        attempt: 1,
        outcome: { _tag: "Succeeded" },
      },
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
      renewLease: () => Effect.succeed("Applied"),
      execute: () => Effect.fail(failure),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 20,
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
      renewLease: () => Effect.succeed("Applied"),
      execute: () =>
        Effect.sync(() => {
          executions += 1
          return { _tag: "Succeeded" as const }
        }),
      now: () => at("2026-08-13T00:01:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:06:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 20,
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

  it("aborts execution and finishes stale when a fenced heartbeat loses ownership", async () => {
    const controller = new AbortController()
    const events: EpisodeWorkerEvent[] = []
    const renewals: unknown[] = []
    let executionAborted = false
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed({ job, recovered: false }),
      renewLease: (input) =>
        Effect.sync(() => {
          renewals.push(input)
          return "StaleLease" as const
        }),
      execute: ({ signal }) =>
        Effect.sync(() =>
          signal?.addEventListener(
            "abort",
            () => {
              executionAborted = true
            },
            { once: true }
          )
        ).pipe(Effect.andThen(Effect.never)),
      now: () => at("2026-08-13T00:02:00.000Z"),
      leasedUntil: () => at("2026-08-13T00:07:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 20,
      backoffMillis: () => 100,
      wait: () => Effect.void,
      observe: (event) =>
        Effect.sync(() => {
          events.push(event)
          if (event._tag === "JobFinished") controller.abort()
        }),
    }

    await Effect.runPromise(runEpisodeWorkerLoop(ports, controller.signal))

    expect(executionAborted).toBe(true)
    expect(renewals).toEqual([
      {
        jobId: job.jobId,
        leaseToken,
        now: at("2026-08-13T00:02:00.000Z"),
        leasedUntil: at("2026-08-13T00:07:00.000Z"),
      },
    ])
    expect(events.at(-2)).toEqual({
      _tag: "JobFinished",
      jobId: job.jobId,
      attempt: 1,
      outcome: { _tag: "StaleLease" },
    })
    expect(events.at(-1)).toEqual({ _tag: "WorkerStopped" })
  })

  it("aborts the active provider immediately after same-process cancellation", async () => {
    const processController = new AbortController()
    const cancellation = makeJobCancellationRegistry()
    const propagated: CancellationPropagation[] = []
    let providerAborted = false
    let renewals = 0
    let finishedOutcome: unknown
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed({ job, recovered: false }),
      renewLease: () =>
        Effect.sync(() => {
          renewals += 1
          return "Applied" as const
        }),
      checkCancellation: () => Effect.succeed({ _tag: "Current" as const }),
      subscribeCancellation: cancellation.subscribe,
      execute: ({ signal }) =>
        Effect.sync(() => {
          signal?.addEventListener(
            "abort",
            () => {
              providerAborted = true
            },
            { once: true }
          )
          cancellation.notify(job.jobId, at("2026-08-13T00:02:00.000Z"))
        }).pipe(Effect.andThen(Effect.never)),
      now: () => at("2026-08-13T00:02:00.010Z"),
      leasedUntil: () => at("2026-08-13T00:07:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 60_000,
      cancellationPollMillis: MAX_CANCELLATION_POLL_MILLIS,
      backoffMillis: () => 100,
      wait: (delay) => Effect.sleep(delay),
      recordCancellationPropagation: (event) => propagated.push(event),
      observe: (event) =>
        Effect.sync(() => {
          if (event._tag === "JobFinished") processController.abort()
          if (event._tag === "JobFinished") finishedOutcome = event.outcome
        }),
    }

    await Effect.runPromise(
      runEpisodeWorkerLoop(ports, processController.signal)
    )

    expect(providerAborted).toBe(true)
    expect(renewals).toBe(0)
    expect(finishedOutcome).toEqual({ _tag: "Canceled" })
    expect(propagated).toEqual([
      {
        jobId: job.jobId,
        source: "same_process",
        latencyMillis: 10,
      },
    ])
  })

  it("polls fencing state so another process cancels within a bounded delay", async () => {
    const processController = new AbortController()
    const propagated: CancellationPropagation[] = []
    const waits: number[] = []
    let providerAborted = false
    let finishedOutcome: unknown
    const ports: EpisodeWorkerPorts = {
      leaseNext: () => Effect.succeed({ job, recovered: false }),
      renewLease: () => Effect.succeed("Applied"),
      checkCancellation: () =>
        Effect.succeed({
          _tag: "Canceled" as const,
          canceledAt: at("2026-08-13T00:02:00.000Z"),
        }),
      subscribeCancellation: () => () => undefined,
      execute: ({ signal }) =>
        Effect.sync(() => {
          signal?.addEventListener(
            "abort",
            () => {
              providerAborted = true
            },
            { once: true }
          )
        }).pipe(Effect.andThen(Effect.never)),
      now: () => at("2026-08-13T00:02:00.250Z"),
      leasedUntil: () => at("2026-08-13T00:07:00.000Z"),
      nextLeaseToken: () => leaseToken,
      heartbeatMillis: 60_000,
      cancellationPollMillis: 250,
      backoffMillis: () => 100,
      wait: (delay) =>
        Effect.sync(() => {
          waits.push(delay)
        }),
      recordCancellationPropagation: (event) => propagated.push(event),
      observe: (event) =>
        Effect.sync(() => {
          if (event._tag === "JobFinished") processController.abort()
          if (event._tag === "JobFinished") finishedOutcome = event.outcome
        }),
    }

    await Effect.runPromise(
      runEpisodeWorkerLoop(ports, processController.signal)
    )

    expect(providerAborted).toBe(true)
    expect(waits).toContain(250)
    expect(finishedOutcome).toEqual({ _tag: "Canceled" })
    expect(250).toBeLessThanOrEqual(MAX_CANCELLATION_POLL_MILLIS)
    expect(propagated).toEqual([
      {
        jobId: job.jobId,
        source: "poll",
        latencyMillis: 250,
      },
    ])
  })
})
