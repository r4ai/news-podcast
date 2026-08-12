import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ExecuteEpisodeJobInput,
  LeasedExecution,
  LeaseNextInput,
  LeaseToken,
  PipelineFailure,
} from "../application/execution-ports.js"
import type { EpisodeExecutionOutcome } from "../application/execute-job.js"
import type { UtcTimestamp } from "../domain/episode-job.js"

export type EpisodeWorkerEvent =
  | Readonly<{
      _tag: "WorkerIdle"
      consecutiveIdle: number
      waitMillis: number
    }>
  | Readonly<{
      _tag: "JobLeased"
      jobId: string
      attempt: number
      recovered: boolean
    }>
  | Readonly<{
      _tag: "JobFinished"
      jobId: string
      outcome: EpisodeExecutionOutcome["_tag"]
    }>
  | Readonly<{
      _tag: "WorkerFailed"
      stage: "lease" | "execute"
      jobId?: string
      code: string
      retryable: boolean
    }>
  | Readonly<{ _tag: "WorkerStopped" }>

export type EpisodeWorkerPorts = Readonly<{
  leaseNext: (
    input: LeaseNextInput
  ) => Effect.Effect<LeasedExecution | undefined, PipelineFailure>
  execute: (
    input: ExecuteEpisodeJobInput
  ) => Effect.Effect<EpisodeExecutionOutcome, PipelineFailure>
  now: () => UtcTimestamp
  leasedUntil: (now: UtcTimestamp) => UtcTimestamp
  nextLeaseToken: () => LeaseToken
  backoffMillis: (consecutiveIdle: number) => number
  wait: (delayMillis: number, signal: AbortSignal) => Effect.Effect<void>
  observe: (event: EpisodeWorkerEvent) => Effect.Effect<void>
}>

const observeFailure = (
  ports: EpisodeWorkerPorts,
  stage: "lease" | "execute",
  failure: PipelineFailure,
  jobId?: string
) =>
  ports.observe(
    deepFreeze({
      _tag: "WorkerFailed",
      stage,
      ...(jobId === undefined ? {} : { jobId }),
      code: failure.code,
      retryable: failure.retryable,
    })
  )

/** Runs one job at a time until cancellation; supervision owns restart policy. */
export const runEpisodeWorkerLoop = (
  ports: EpisodeWorkerPorts,
  signal: AbortSignal
): Effect.Effect<void, PipelineFailure> =>
  Effect.gen(function* () {
    let consecutiveIdle = 0
    while (!signal.aborted) {
      const now = ports.now()
      const leased = yield* ports
        .leaseNext({
          now,
          leasedUntil: ports.leasedUntil(now),
          leaseToken: ports.nextLeaseToken(),
        })
        .pipe(
          Effect.tapError((failure) => observeFailure(ports, "lease", failure))
        )
      if (leased === undefined) {
        consecutiveIdle += 1
        const waitMillis = ports.backoffMillis(consecutiveIdle)
        yield* ports.observe(
          deepFreeze({ _tag: "WorkerIdle", consecutiveIdle, waitMillis })
        )
        yield* ports.wait(waitMillis, signal)
        continue
      }

      consecutiveIdle = 0
      yield* ports.observe(
        deepFreeze({
          _tag: "JobLeased",
          jobId: leased.job.jobId,
          attempt: leased.job.attempt,
          recovered: leased.recovered,
        })
      )
      const outcome = yield* ports
        .execute({ job: leased.job, signal })
        .pipe(
          Effect.tapError((failure) =>
            observeFailure(ports, "execute", failure, leased.job.jobId)
          )
        )
      yield* ports.observe(
        deepFreeze({
          _tag: "JobFinished",
          jobId: leased.job.jobId,
          outcome: outcome._tag,
        })
      )
    }
    yield* ports.observe(deepFreeze({ _tag: "WorkerStopped" }))
  })
