import type {
  Observability,
  TelemetryAttributes,
} from "@news-podcast/observability"

import type { ScriptQualityObservation } from "../adapters/providers/openai-script-generator.js"
import type { EpisodeWorkerEvent } from "./loops/worker.js"
import type { CancellationPropagation } from "./loops/worker.js"

type WorkerTelemetry = Pick<Observability, "count" | "log"> &
  Partial<Pick<Observability, "measure">>

type JobSnapshot = {
  readonly status: string
  readonly count: number
  readonly oldestActiveAt?: string
}

type OwnerActiveSnapshot = {
  readonly ownerId: string
  readonly count: number
  readonly oldestActiveAt: string
}

export const recordEpisodeJobSnapshots = (
  observability: Pick<Observability, "gauge">,
  input: {
    readonly now: string
    readonly statuses: readonly JobSnapshot[]
    readonly owners: readonly OwnerActiveSnapshot[]
  }
): void => {
  const age = (createdAt: string): number =>
    Math.max(0, Date.parse(input.now) - Date.parse(createdAt))

  for (const state of input.statuses)
    observability.gauge("episode.jobs", state.count, {
      "job.status": state.status,
    })
  const oldest = input.statuses
    .map((state) => state.oldestActiveAt)
    .filter((value): value is string => value !== undefined)
    .sort()[0]
  observability.gauge(
    "episode.queue.oldest.age",
    oldest === undefined ? 0 : age(oldest)
  )
  observability.gauge(
    "episode.owner.active_jobs",
    Math.max(0, ...input.owners.map((owner) => owner.count))
  )
  observability.gauge(
    "episode.owner.queue.oldest.age",
    Math.max(0, ...input.owners.map((owner) => age(owner.oldestActiveAt)))
  )
}

export const recordScriptQualityObservation = (
  observability: WorkerTelemetry,
  observation: ScriptQualityObservation
): void => {
  const attributes = {
    "gen_ai.request.model": observation.model,
    "episode.script.prompt.version": observation.generationPromptVersion,
    "episode.script.quality_prompt.version": observation.qualityPromptVersion,
    "quality.outcome": observation.outcome,
    "quality.reason": observation.reasonCode,
  } as const
  observability.count("episode.script.quality", 1, attributes)
  observability.log({
    name: "episode.script.quality_evaluated",
    level: observation.outcome === "reject" ? "warn" : "info",
    attributes,
  })
}

export const recordCancellationPropagation = (
  observability: Pick<Observability, "measure">,
  event: CancellationPropagation
): void => {
  observability.measure(
    "episode.cancellation.propagation.duration",
    event.latencyMillis,
    { source: event.source }
  )
}

const failureAttributes = (
  event: Extract<EpisodeWorkerEvent, { _tag: "JobFinished" }>
): TelemetryAttributes => {
  if (event.outcome._tag !== "Retrying" && event.outcome._tag !== "Failed")
    return {}
  const [stage, ...reasonParts] = event.outcome.failureCode.split("_")
  return {
    "job.id": event.jobId,
    "job.attempt": event.attempt,
    "failure.code": event.outcome.failureCode,
    "failure.stage": stage ?? "unknown",
    "failure.reason": reasonParts.join("_") || event.outcome.failureCode,
    "error.retryable": event.outcome._tag === "Retrying",
    ...(event.outcome._tag === "Retrying"
      ? { "job.next_retry_at": String(event.outcome.retryAt) }
      : {}),
  }
}

export const recordEpisodeWorkerEvent = (
  observability: WorkerTelemetry,
  event: EpisodeWorkerEvent
): void => {
  switch (event._tag) {
    case "JobLeased":
      observability.count("episode.started", 1, {
        "job.attempt": event.attempt,
      })
      observability.measure?.(
        "episode.queue.wait.duration",
        event.queueWaitMillis
      )
      if (event.recovered) observability.count("episode.lease.recovered")
      return
    case "JobFinished":
      if (event.outcome._tag === "Succeeded")
        observability.count("episode.succeeded")
      if (event.outcome._tag === "Retrying") {
        observability.count("episode.retry")
        observability.log({
          name: "episode.retrying",
          level: "warn",
          attributes: failureAttributes(event),
        })
      }
      if (event.outcome._tag === "Failed") {
        observability.count("episode.failed")
        if (event.outcome.failureCode === "job_deadline_exceeded")
          observability.count("episode.deadline.exceeded")
        observability.log({
          name: "episode.failed",
          level: "error",
          attributes: failureAttributes(event),
        })
      }
      if (event.outcome._tag === "Canceled")
        observability.count("episode.canceled")
      if (event.outcome._tag === "StaleLease")
        observability.count("episode.lease.lost")
      return
    case "WorkerFailed": {
      const [failureStage, ...failureReasonParts] = event.code.split("_")
      observability.count("process.error", 1, {
        "failure.code": event.code,
        "failure.stage":
          failureStage === "script" || failureStage === "speech"
            ? failureStage
            : event.stage,
        "failure.reason":
          failureStage === "script" || failureStage === "speech"
            ? failureReasonParts.join("_")
            : event.code,
        "operation.stage": event.stage,
      })
      observability.log({
        name: "worker.tick.failed",
        level: "error",
        attributes: {
          ...(event.jobId === undefined ? {} : { "job.id": event.jobId }),
          "failure.code": event.code,
          "operation.stage": event.stage,
          "error.retryable": event.retryable,
        },
      })
      return
    }
    case "WorkerIdle":
    case "WorkerStopped":
      return
  }
}
