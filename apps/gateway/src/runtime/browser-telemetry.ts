import { isEpisodeFailureCode } from "@news-podcast/contracts/episode-failure"

/** Untrusted OTLP JSON is rebuilt from a finite browser vocabulary, never forwarded. */
export class InvalidBrowserTelemetry extends Error {}

export const browserEvents = new Set([
  "audio.completed",
  "audio.error",
  "audio.started",
  "enrich.reprocess_requested",
  "episode.requested",
  "episode.failure_presented",
  "episode.stream_connected",
  "episode.stream_fallback",
  "interest_profile.changed",
  "login.result",
  "logout.result",
  "panel.error",
  "route.error",
  "schedule.changed",
  "subscription.changed",
  "browser.error",
])
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
])
const errors = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AbortError",
  "TimeoutError",
  "UnknownError",
])
const bounds = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
]
type Obj = Record<string, unknown>
const invalid = (): never => {
  throw new InvalidBrowserTelemetry()
}
const object = (value: unknown): Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : invalid()
const array = (value: unknown, maximum: number): unknown[] =>
  Array.isArray(value) && value.length <= maximum ? value : invalid()
const number = (value: unknown, maximum = 1e12): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= maximum
    ? value
    : invalid()
const integer = (value: unknown, maximum = 1e12): number => {
  const result = number(value, maximum)
  return Number.isInteger(result) ? result : invalid()
}
const nanos = (value: unknown): string =>
  typeof value === "string" &&
  /^\d{1,20}$/.test(value) &&
  BigInt(value) <= 18_446_744_073_709_551_615n
    ? value
    : invalid()
const id = (value: unknown, length: number): string | undefined =>
  typeof value === "string" &&
  value.length === length &&
  /^[a-f\d]+$/i.test(value)
    ? value.toLowerCase()
    : undefined
const enumValue = (value: unknown, allowed: Set<string>) =>
  typeof value === "string" && allowed.has(value) ? value : undefined

const attributeValue = (
  key: string,
  value: Obj,
  metrics: boolean
): string | number | undefined => {
  const text = value.stringValue
  switch (key) {
    case "event.name":
      return enumValue(text, browserEvents)
    case "result":
      return enumValue(text, new Set(["succeeded", "failed"]))
    case "web_vital.name":
      return enumValue(text, new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]))
    case "web_vital.rating":
      return enumValue(text, new Set(["good", "needs-improvement", "poor"]))
    case "error.source":
      return enumValue(text, new Set(["window.error", "unhandledrejection"]))
    case "error.type":
      return typeof text === "string"
        ? errors.has(text)
          ? text
          : "UnknownError"
        : undefined
    case "http.method":
    case "http.request.method":
      return enumValue(text, methods)
    case "http.status_code":
    case "http.response.status_code": {
      const code = Number(value.intValue)
      return Number.isInteger(code) && code >= 100 && code <= 599
        ? code
        : undefined
    }
    case "failure.code":
      return typeof text === "string" &&
        (isEpisodeFailureCode(text) || text === "unknown")
        ? text
        : undefined
    case "job.id":
      return !metrics &&
        typeof text === "string" &&
        /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(text)
        ? text.toLowerCase()
        : undefined
    default:
      return undefined
  }
}

const attributes = (value: unknown, metrics = false) => {
  const output = new Map<string, string | number>()
  for (const candidate of array(value ?? [], 64)) {
    const item = object(candidate)
    if (typeof item.key !== "string") invalid()
    const safe = attributeValue(item.key as string, object(item.value), metrics)
    if (safe !== undefined) output.set(item.key as string, safe)
  }
  return [...output].map(([key, value]) => ({
    key,
    value:
      typeof value === "string"
        ? { stringValue: value }
        : { intValue: String(value) },
  }))
}

const correlation = (item: Obj) => {
  const traceId = id(item.traceId, 32)
  const spanId = id(item.spanId, 16)
  return traceId && spanId ? { traceId, spanId } : {}
}
const span = (value: unknown) => {
  const item = object(value)
  const name =
    enumValue(item.name, browserEvents) ??
    (typeof item.name === "string" &&
    (methods.has(item.name) ||
      /^HTTP (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(item.name))
      ? item.name
      : undefined)
  if (!name || !id(item.traceId, 32) || !id(item.spanId, 16)) invalid()
  const startTimeUnixNano = nanos(item.startTimeUnixNano)
  const endTimeUnixNano = nanos(item.endTimeUnixNano)
  if (
    BigInt(endTimeUnixNano) < BigInt(startTimeUnixNano) ||
    BigInt(endTimeUnixNano) - BigInt(startTimeUnixNano) > 300_000_000_000n
  )
    invalid()
  const code = integer(object(item.status ?? {}).code ?? 0, 2)
  return {
    name,
    ...correlation(item),
    ...(id(item.parentSpanId, 16)
      ? { parentSpanId: id(item.parentSpanId, 16) }
      : {}),
    kind: methods.has(String(name).replace(/^HTTP /, "")) ? 3 : 1,
    startTimeUnixNano,
    endTimeUnixNano,
    status: { code },
    attributes: attributes(item.attributes),
  }
}
const log = (value: unknown) => {
  const item = object(value)
  const body = enumValue(object(item.body).stringValue, browserEvents)
  if (!body) invalid()
  return {
    timeUnixNano: nanos(item.timeUnixNano),
    body: { stringValue: body },
    severityNumber: body === "browser.error" ? 17 : 9,
    severityText: body === "browser.error" ? "ERROR" : "INFO",
    attributes: attributes(item.attributes),
    ...correlation(item),
  }
}
const metric = (value: unknown, consume: () => void) => {
  const item = object(value)
  if (item.name !== "browser.event" && item.name !== "browser.web_vital")
    invalid()
  const histogram = item.name === "browser.web_vital"
  const data = object(histogram ? item.histogram : item.sum)
  const points = array(data.dataPoints, 128).map((raw) => {
    consume()
    const point = object(raw)
    const base = {
      startTimeUnixNano: nanos(point.startTimeUnixNano),
      timeUnixNano: nanos(point.timeUnixNano),
      attributes: attributes(point.attributes, true).filter(({ key }) =>
        (histogram
          ? ["web_vital.name", "web_vital.rating"]
          : ["event.name", "result", "failure.code"]
        ).includes(key)
      ),
    }
    if (!histogram)
      return {
        ...base,
        asDouble: number(point.asDouble ?? Number(point.asInt)),
      }
    // A fixed boundary set prevents arbitrary `le` labels in Prometheus.
    if (JSON.stringify(point.explicitBounds) !== JSON.stringify(bounds))
      invalid()
    const bucketCounts = array(point.bucketCounts, bounds.length + 1).map(
      (count) => integer(Number(count))
    )
    const count = integer(Number(point.count))
    if (
      bucketCounts.length !== bounds.length + 1 ||
      bucketCounts.reduce((sum, n) => sum + n, 0) !== count
    )
      invalid()
    return {
      ...base,
      count: String(count),
      sum: number(point.sum),
      explicitBounds: bounds,
      bucketCounts: bucketCounts.map(String),
    }
  })
  if (data.aggregationTemporality !== 1 && data.aggregationTemporality !== 2)
    invalid()
  return {
    name: item.name,
    unit: "",
    description: "",
    [histogram ? "histogram" : "sum"]: {
      dataPoints: points,
      aggregationTemporality: data.aggregationTemporality,
      ...(!histogram ? { isMonotonic: true } : {}),
    },
  }
}

export type BrowserSignal = "traces" | "logs" | "metrics"
export const sanitizeBrowserTelemetry = (
  signal: BrowserSignal,
  value: unknown
) => {
  const [resourceKey, scopeKey, recordKey] =
    signal === "traces"
      ? ["resourceSpans", "scopeSpans", "spans"]
      : signal === "logs"
        ? ["resourceLogs", "scopeLogs", "logRecords"]
        : ["resourceMetrics", "scopeMetrics", "metrics"]
  let remaining = 128
  const consume = () => {
    if (--remaining < 0) invalid()
  }
  const records: unknown[] = []
  for (const resource of array(object(value)[resourceKey!], 8)) {
    for (const scope of array(object(resource)[scopeKey!] ?? [], 16)) {
      for (const record of array(object(scope)[recordKey!] ?? [], 128)) {
        consume()
        records.push(
          signal === "traces"
            ? span(record)
            : signal === "logs"
              ? log(record)
              : metric(record, consume)
        )
      }
    }
  }
  return {
    [resourceKey!]: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "news-podcast-web" } },
            { key: "telemetry.source", value: { stringValue: "browser" } },
            { key: "telemetry.trust", value: { stringValue: "untrusted" } },
          ],
        },
        [scopeKey!]: [
          { scope: { name: "news-podcast-web" }, [recordKey!]: records },
        ],
      },
    ],
  }
}
