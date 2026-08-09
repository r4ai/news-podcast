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
  readonly link?: TraceContext
}

export interface Observability {
  log(event: TelemetryEvent): void
  withSpan<T>(
    name: string,
    attributes: TelemetryAttributes,
    operation: () => Promise<T>,
    options?: SpanOptions
  ): Promise<T>
  count(name: MetricName, value?: number): void
  measure(name: MetricName, value: number): void
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
  "rss.sync.succeeded",
  "rss.sync.failed",
  "article.archive.succeeded",
  "article.archive.failed",
] as const

export type TelemetryEventName = (typeof telemetryEventNames)[number]

export const metricNames = [
  "episode.requested",
  "episode.succeeded",
  "episode.failed",
  "episode.duration",
  "episode.stage.duration",
  "http.server.duration",
] as const

export type MetricName = (typeof metricNames)[number]
