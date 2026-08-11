export type TelemetryAttribute = string | number | boolean

export type TelemetryAttributes = Readonly<Record<string, TelemetryAttribute>>

export interface TraceContext {
  readonly traceParent: string
  readonly traceState?: string
}

export interface TelemetryEvent {
  readonly name: TelemetryEventName
  readonly level?: "debug" | "info" | "warn" | "error"
  readonly attributes?: TelemetryAttributes
  readonly error?: unknown
}

export interface SpanOptions {
  readonly parent?: TraceContext
  readonly link?: TraceContext
  readonly kind?: "internal" | "client"
}

export interface Observability {
  log(event: TelemetryEvent): void
  withSpan<T>(
    name: string,
    attributes: TelemetryAttributes,
    operation: () => Promise<T>,
    options?: SpanOptions
  ): Promise<T>
  count(
    name: MetricName,
    value?: number,
    attributes?: TelemetryAttributes
  ): void
  measure(
    name: MetricName,
    value: number,
    attributes?: TelemetryAttributes
  ): void
  gauge(name: MetricName, value: number, attributes?: TelemetryAttributes): void
  captureContext(): TraceContext | undefined
  shutdown(): Promise<void>
}

export const telemetryEventNames = [
  "api.request",
  "episode.requested",
  "episode.started",
  "episode.stage.completed",
  "episode.retrying",
  "episode.succeeded",
  "episode.failed",
  "episode.lease.renewed",
  "episode.lease.recovered",
  "episode.lease.lost",
  "episode.lease.expired",
  "episode.deadline.exceeded",
  "episode.checkpoint",
  "provider.request",
  "object.cleanup.succeeded",
  "object.cleanup.failed",
  "worker.heartbeat",
  "worker.tick.failed",
  "api.heartbeat",
  "rss.sync.succeeded",
  "rss.sync.failed",
  "article.archive.succeeded",
  "article.archive.failed",
  "article.search_body.index_failed",
  "article.enrich.summary.succeeded",
  "article.enrich.summary.failed",
  "article.enrich.relevance.succeeded",
  "article.enrich.relevance.failed",
  "article.enrich.rate_limited",
] as const

export type TelemetryEventName = (typeof telemetryEventNames)[number]

export const metricNames = [
  "episode.requested",
  "episode.started",
  "episode.succeeded",
  "episode.failed",
  "episode.canceled",
  "episode.retry",
  "episode.lease.renewed",
  "episode.lease.recovered",
  "episode.lease.lost",
  "episode.lease.expired",
  "episode.deadline.exceeded",
  "episode.attempt_limit.exceeded",
  "episode.checkpoint",
  "episode.audio.chunk",
  "episode.jobs",
  "episode.queue.oldest.age",
  "episode.stage.oldest.age",
  "episode.staging.bytes",
  "episode.cleanup.backlog",
  "object.cleanup",
  "provider.request",
  "provider.request.duration",
  "worker.heartbeat",
  "api.heartbeat",
  "otlp.canary",
  "episode.duration",
  "episode.stage.duration",
  "http.server.duration",
  "article.enrich.processed",
  "article.enrich.tokens",
] as const

export type MetricName = (typeof metricNames)[number]

export const metricUnits: Readonly<Record<MetricName, string>> = {
  "episode.requested": "{job}",
  "episode.started": "{job}",
  "episode.succeeded": "{job}",
  "episode.failed": "{job}",
  "episode.canceled": "{job}",
  "episode.retry": "{retry}",
  "episode.lease.renewed": "{renewal}",
  "episode.lease.recovered": "{lease}",
  "episode.lease.lost": "{lease}",
  "episode.lease.expired": "{lease}",
  "episode.deadline.exceeded": "{job}",
  "episode.attempt_limit.exceeded": "{job}",
  "episode.checkpoint": "{checkpoint}",
  "episode.audio.chunk": "{chunk}",
  "episode.jobs": "{job}",
  "episode.queue.oldest.age": "ms",
  "episode.stage.oldest.age": "ms",
  "episode.staging.bytes": "By",
  "episode.cleanup.backlog": "{object}",
  "object.cleanup": "{object}",
  "provider.request": "{request}",
  "provider.request.duration": "ms",
  "worker.heartbeat": "1",
  "api.heartbeat": "1",
  "otlp.canary": "{canary}",
  "episode.duration": "ms",
  "episode.stage.duration": "ms",
  "http.server.duration": "ms",
  "article.enrich.processed": "{article}",
  "article.enrich.tokens": "{token}",
}
