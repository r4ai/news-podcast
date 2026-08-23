import type { TelemetryAttributes } from "./contract.js"

const allowedAttributes = new Set([
  "deployment.environment",
  "app.env",
  "error.message",
  "error.retryable",
  "error.source",
  "error.type",
  "failure.code",
  "failure.stage",
  "failure.reason",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "messaging.destination.name",
  "messaging.operation.type",
  "messaging.system",
  "db.operation.name",
  "db.system.name",
  "rpc.method",
  "schedule.outcome",
  "server.address",
  "service.peer.name",
  "peer.service",
  "operation.stage",
  "job.id",
  "job.attempt",
  "job.max_attempts",
  "job.next_retry_at",
  "job.status",
  "checkpoint.result",
  "cleanup.attempted",
  "cleanup.deleted",
  "cleanup.failed",
  "cleanup.result",
  "lease.result",
  "provider.name",
  "provider.mode",
  "provider.operation",
  "provider.outcome",
  "service.name",
  "service.version",
  "telemetry.schema.version",
  "trace.entry.synthesized",
  "trigger",
  "actor.id",
  "owner.id",
])

const allowedMetricAttributes = new Set([
  "deployment.environment",
  "app.env",
  "error.retryable",
  "error.source",
  "failure.code",
  "failure.stage",
  "failure.reason",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "messaging.destination.name",
  "messaging.operation.type",
  "messaging.system",
  "db.operation.name",
  "db.system.name",
  "rpc.method",
  "schedule.outcome",
  "server.address",
  "service.peer.name",
  "peer.service",
  "operation.stage",
  "job.attempt",
  "job.max_attempts",
  "job.status",
  "checkpoint.result",
  "cleanup.result",
  "lease.result",
  "provider.name",
  "provider.mode",
  "provider.operation",
  "provider.outcome",
  "service.name",
  "service.version",
  "trace.entry.synthesized",
  "trigger",
])

export function sanitizeAttributes(
  attributes: TelemetryAttributes
): TelemetryAttributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([name]) => allowedAttributes.has(name))
      .map(([name, value]) => [
        name,
        name === "error.message" && typeof value === "string"
          ? redact(value)
          : value,
      ])
  )
}

export function sanitizeMetricAttributes(
  attributes: TelemetryAttributes
): TelemetryAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([name]) =>
      allowedMetricAttributes.has(name)
    )
  )
}

export function normalizedError(error: unknown): {
  readonly type: string
  readonly message: string
} {
  if (!(error instanceof Error)) {
    return { type: "UnknownError", message: "Unknown failure" }
  }
  return { type: error.name || "Error", message: redact(error.message) }
}

function redact(message: string): string {
  return message
    .replaceAll(/https?:\/\/\S+/gi, "[url]")
    .replaceAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[secret]"
    )
    .replaceAll(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[secret]")
    .replaceAll(/\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=_\-.]{8,}/gi, "[secret]")
    .replaceAll(/\bsk[-_A-Za-z0-9.]{8,}\b/g, "[secret]")
    .replaceAll(
      /\b(x-api-key|api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*["']?[^\s,;"']+["']?/gi,
      "$1=[secret]"
    )
    .slice(0, 500)
}
