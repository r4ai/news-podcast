import { SpanStatusCode, trace } from "@opentelemetry/api"
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

let started = false

export function start(): void {
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
      root: new TraceIdRatioBasedSampler(0.2),
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
    eventCounter.add(1, { "event.name": name, ...safe })
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

  window.addEventListener("error", (event) => {
    recordError("window.error", event.error)
  })
  window.addEventListener("unhandledrejection", (event) => {
    recordError("unhandledrejection", event.reason)
  })

  function recordError(source: string, error: unknown) {
    const type = error instanceof Error ? error.name : "UnknownError"
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "error",
      body: "browser.error",
      attributes: { "error.type": type, "error.source": source },
    })
    const span = tracer.startSpan("browser.error")
    span.setAttribute("error.type", type)
    span.setStatus({ code: SpanStatusCode.ERROR })
    span.end()
  }
}

const allowedEventAttributes = new Set([
  "action",
  "result",
  "status",
  "error.type",
])

function sanitizeEventAttributes(
  attributes: BrowserEventAttributes
): BrowserEventAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([name]) =>
      allowedEventAttributes.has(name)
    )
  )
}

export type { BrowserEventName }
