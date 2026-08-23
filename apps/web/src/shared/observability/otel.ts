import {
  ROOT_CONTEXT,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api"
import { SeverityNumber } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs"
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics"
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base"
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web"
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals"

import {
  installBrowserEventRecorder,
  type BrowserEventAttributes,
  type BrowserEventName,
} from "./events"
import type { PreInitErrorLog } from "./pre-init-errors"
import type { PreInitFetchLog } from "./pre-init-fetch"
import { TRACE_SAMPLE_RATIO } from "./trace-context"

let started = false

export type PreInitLogs = {
  readonly fetches: PreInitFetchLog
  readonly errors: PreInitErrorLog
}

export function start(preInit?: PreInitLogs): void {
  if (started) return
  started = true
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "news-podcast-web",
    [ATTR_SERVICE_VERSION]:
      import.meta.env.VITE_SERVICE_VERSION ?? "development",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: import.meta.env.MODE,
    "telemetry.schema.version": "1",
  })
  const tracerProvider = new WebTracerProvider({
    resource,
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(TRACE_SAMPLE_RATIO),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: "/v1/telemetry/traces" })
      ),
    ],
  })
  tracerProvider.register()
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        clearTimingResources: true,
        ignoreUrls: [/\/v1\/telemetry\//],
        propagateTraceHeaderCorsUrls: [location.origin],
      }),
    ],
  })

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: "/v1/telemetry/logs" }),
      }),
    ],
  })
  const logger = loggerProvider.getLogger("news-podcast-web")
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: "/v1/telemetry/metrics" }),
        exportIntervalMillis: 30_000,
      }),
    ],
  })
  const meter = meterProvider.getMeter("news-podcast-web")
  const eventCounter = meter.createCounter("browser.event")
  const vitalHistogram = meter.createHistogram("browser.web_vital")
  const tracer = trace.getTracer("news-podcast-web")

  installBrowserEventRecorder((name, attributes) => {
    const safe = sanitizeEventAttributes(attributes)
    eventCounter.add(1, {
      "event.name": name,
      ...sanitizeMetricEventAttributes(safe),
    })
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "info",
      body: name,
      attributes: { "event.name": name, ...safe },
    })
    tracer.startSpan(name, { attributes: safe }).end()
  })

  const recordVital = (metric: Metric) =>
    vitalHistogram.record(metric.value, {
      "web_vital.name": metric.name,
      "web_vital.rating": metric.rating,
    })
  onCLS(recordVital)
  onFCP(recordVital)
  onINP(recordVital)
  onLCP(recordVital)
  onTTFB(recordVital)

  // 計装が着く前に飛んだ分を、記録しておいた実時刻のままspanへ起こす。
  // 送信済みの`traceparent`と同じtrace idの下へ置くことで、Gatewayが作った
  // server spanと同じtraceへ揃う (ADR-0017)。親に指すspan idは実体を持たない
  // が、trace idが一致していれば経路はたどれる。
  for (const request of preInit?.fetches.drain() ?? []) {
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: request.spanContext.traceId,
      spanId: request.spanContext.spanId,
      traceFlags: request.spanContext.sampled
        ? TraceFlags.SAMPLED
        : TraceFlags.NONE,
      isRemote: true,
    })
    const span = tracer.startSpan(
      `HTTP ${request.method}`,
      {
        startTime: request.startTime,
        attributes: {
          "http.request.method": request.method,
          "url.full": request.url,
          // 自動計装のspanとは属性が完全には揃わないので、区別できるようにする。
          "otel.instrumentation.deferred": true,
          ...(request.status === undefined
            ? {}
            : { "http.response.status_code": request.status }),
          ...(request.errorType === undefined
            ? {}
            : { "error.type": request.errorType }),
        },
      },
      parent
    )
    if (request.errorType !== undefined || (request.status ?? 0) >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    span.end(request.endTime)
  }

  // 購読が着く前に起きたエラーも、起きた時刻のまま記録する。
  for (const error of preInit?.errors.drain() ?? []) {
    emitError(error.source, error.errorType, error.time)
  }

  window.addEventListener("error", (event) => {
    recordError("window.error", event.error)
  })
  window.addEventListener("unhandledrejection", (event) => {
    recordError("unhandledrejection", event.reason)
  })

  function recordError(source: string, error: unknown) {
    emitError(
      source,
      error instanceof Error ? error.name : "UnknownError",
      Date.now()
    )
  }

  function emitError(source: string, type: string, time: number) {
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "error",
      body: "browser.error",
      attributes: { "error.type": type, "error.source": source },
    })
    const span = tracer.startSpan("browser.error", { startTime: time })
    span.setAttribute("error.type", type)
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.end(time)
  }
}

const allowedEventAttributes = new Set([
  "action",
  "result",
  "status",
  "error.type",
  "failure.code",
  "job.id",
])

export function sanitizeEventAttributes(
  attributes: BrowserEventAttributes
): BrowserEventAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([name]) =>
      allowedEventAttributes.has(name)
    )
  )
}

export function sanitizeMetricEventAttributes(
  attributes: BrowserEventAttributes
): BrowserEventAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([name]) => name !== "job.id")
  )
}

export type { BrowserEventName }
