import type { TelemetryAttributes } from "./contract.js"

const allowedAttributes = new Set([
  "deployment.environment",
  "error.retryable",
  "error.type",
  "failure.code",
  "http.request.method",
  "http.response.status_code",
  "operation.stage",
  "job.id",
  "job.attempt",
  "job.max_attempts",
  "job.status",
  "checkpoint.result",
  "cleanup.result",
  "lease.result",
  "provider.name",
  "provider.operation",
  "provider.outcome",
  "service.name",
  "service.version",
  "telemetry.schema.version",
  "trigger",
])

const allowedMetricAttributes = new Set([
  "deployment.environment",
  "error.retryable",
  "failure.code",
  "http.request.method",
  "http.response.status_code",
  "operation.stage",
  "job.attempt",
  "job.max_attempts",
  "job.status",
  "checkpoint.result",
  "cleanup.result",
  "lease.result",
  "provider.name",
  "provider.operation",
  "provider.outcome",
  "service.name",
  "service.version",
  "trigger",
])

export function sanitizeAttributes(
  attributes: TelemetryAttributes
): TelemetryAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([name]) => allowedAttributes.has(name))
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
    .replaceAll(/\b(?:sk|Bearer)[-_ A-Za-z0-9.]{8,}\b/g, "[secret]")
    .slice(0, 500)
}
