import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ExecuteEpisodeJobInput,
  LeasedExecution,
  LeaseNextInput,
  LeaseRenewalResult,
  LeaseToken,
  PipelineFailure,
  RenewLeaseInput,
} from "../../application/ports/execution.js"
import type { EpisodeExecutionOutcome } from "../../application/execute-job.js"
import type { UtcTimestamp } from "../../domain/episode-job.js"

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
      attempt: number
      outcome: EpisodeExecutionOutcome
    }>
  | Readonly<{
      _tag: "WorkerFailed"
      stage: "lease" | "heartbeat" | "execute"
      jobId?: string
      code: string
      retryable: boolean
    }>
  | Readonly<{ _tag: "WorkerStopped" }>

export type EpisodeWorkerPorts = Readonly<{
  leaseNext: (
    input: LeaseNextInput
  ) => Effect.Effect<LeasedExecution | undefined, PipelineFailure>
  renewLease: (
    input: RenewLeaseInput
  ) => Effect.Effect<LeaseRenewalResult, PipelineFailure>
  execute: (
    input: ExecuteEpisodeJobInput
  ) => Effect.Effect<EpisodeExecutionOutcome, PipelineFailure>
  now: () => UtcTimestamp
  leasedUntil: (now: UtcTimestamp) => UtcTimestamp
  nextLeaseToken: () => LeaseToken
  heartbeatMillis: number
  backoffMillis: (consecutiveIdle: number) => number
  wait: (delayMillis: number, signal: AbortSignal) => Effect.Effect<void>
  observe: (event: EpisodeWorkerEvent) => Effect.Effect<void>
}>

const observeFailure = (
  ports: EpisodeWorkerPorts,
  stage: "lease" | "heartbeat" | "execute",
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

const runWithHeartbeat = (
  ports: EpisodeWorkerPorts,
  leased: LeasedExecution,
  processSignal: AbortSignal
): Effect.Effect<EpisodeExecutionOutcome, PipelineFailure> =>
  Effect.gen(function* () {
    const controller = new AbortController()
    let leaseLost = false
    const abortExecution = () => controller.abort()
    if (processSignal.aborted) abortExecution()
    else processSignal.addEventListener("abort", abortExecution, { once: true })

    const heartbeat = Effect.gen(function* () {
      while (!controller.signal.aborted) {
        yield* ports.wait(ports.heartbeatMillis, controller.signal)
        if (controller.signal.aborted) return yield* Effect.never
        const now = ports.now()
        const result = yield* ports
          .renewLease({
            jobId: leased.job.jobId,
            leaseToken: leased.job.lease.token,
            now,
            leasedUntil: ports.leasedUntil(now),
          })
          .pipe(
            Effect.tapError((failure) =>
              observeFailure(ports, "heartbeat", failure, leased.job.jobId)
            )
          )
        if (result === "StaleLease") {
          leaseLost = true
          abortExecution()
          return deepFreeze({ _tag: "StaleLease" as const })
        }
      }
      return yield* Effect.never
    })

    return yield* Effect.raceFirst(
      ports
        .execute({ job: leased.job, signal: controller.signal })
        .pipe(
          Effect.tapError((failure) =>
            observeFailure(ports, "execute", failure, leased.job.jobId)
          )
        ),
      heartbeat
    ).pipe(
      Effect.map((outcome) =>
        leaseLost ? deepFreeze({ _tag: "StaleLease" as const }) : outcome
      ),
      Effect.ensuring(
        Effect.sync(() => {
          processSignal.removeEventListener("abort", abortExecution)
          abortExecution()
        })
      )
    )
  })

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
      const outcome = yield* runWithHeartbeat(ports, leased, signal)
      yield* ports.observe(
        deepFreeze({
          _tag: "JobFinished",
          jobId: leased.job.jobId,
          attempt: leased.job.attempt,
          outcome,
        })
      )
    }
    yield* ports.observe(deepFreeze({ _tag: "WorkerStopped" }))
  })
