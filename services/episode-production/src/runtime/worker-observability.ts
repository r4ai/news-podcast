import type {
  Observability,
  TelemetryAttributes,
} from "@news-podcast/observability"

import type { EpisodeWorkerEvent } from "./loops/worker.js"

type WorkerTelemetry = Pick<Observability, "count" | "log">

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
