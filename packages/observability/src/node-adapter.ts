import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type SpanContext,
} from "@opentelemetry/api"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { NodeSDK } from "@opentelemetry/sdk-node"
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base"
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"

import type {
  MetricName,
  Observability,
  TelemetryEvent,
  TraceContext,
} from "./contract.js"
import { noopObservability } from "./noop-adapter.js"
import { normalizedError, sanitizeAttributes } from "./privacy.js"

export interface NodeObservabilityConfig {
  readonly enabled: boolean
  readonly endpoint?: string
  readonly headers?: string
  readonly serviceName: string
  readonly serviceVersion: string
  readonly environment: string
  readonly traceSampleRate: number
}

export function readNodeObservabilityConfig(
  environment: NodeJS.ProcessEnv,
  serviceName: string
): NodeObservabilityConfig {
  const enabled = environment.OTEL_ENABLED === "true"
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (enabled && !endpoint) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL is enabled"
    )
  }
  const traceSampleRate = Number(environment.OTEL_TRACE_SAMPLE_RATE ?? "0.2")
  if (
    !Number.isFinite(traceSampleRate) ||
    traceSampleRate < 0 ||
    traceSampleRate > 1
  ) {
    throw new Error("OTEL_TRACE_SAMPLE_RATE must be between 0 and 1")
  }
  return {
    enabled,
    ...(endpoint ? { endpoint } : {}),
    ...(environment.OTEL_EXPORTER_OTLP_HEADERS
      ? { headers: environment.OTEL_EXPORTER_OTLP_HEADERS }
      : {}),
    serviceName,
    serviceVersion: environment.OTEL_SERVICE_VERSION ?? "development",
    environment: environment.APP_ENV ?? "development",
    traceSampleRate,
  }
}

export function createNodeObservability(
  config: NodeObservabilityConfig
): Observability {
  if (!config.enabled || !config.endpoint) return noopObservability

  const headers = parseHeaders(config.headers)
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    "telemetry.schema.version": "1",
  })
  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: signalUrl(config.endpoint, "traces"),
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: signalUrl(config.endpoint, "metrics"),
        headers,
      }),
      exportIntervalMillis: 30_000,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: signalUrl(config.endpoint, "logs"),
          headers,
        }),
      }),
    ],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.traceSampleRate),
    }),
  })
  sdk.start()

  const tracer = trace.getTracer(config.serviceName, config.serviceVersion)
  const logger = logs.getLogger(config.serviceName, config.serviceVersion)
  const meter = metrics.getMeter(config.serviceName, config.serviceVersion)
  const counters = new Map<MetricName, ReturnType<typeof meter.createCounter>>()
  const histograms = new Map<
    MetricName,
    ReturnType<typeof meter.createHistogram>
  >()
  const gauges = new Map<MetricName, ReturnType<typeof meter.createGauge>>()

  return {
    log(event) {
      const error = event.error ? normalizedError(event.error) : undefined
      logger.emit({
        severityNumber: severityNumber(event.level),
        severityText: event.level ?? "info",
        body: event.name,
        attributes: sanitizeAttributes({
          ...(event.attributes ?? {}),
          ...(error
            ? { "error.type": error.type, "error.message": error.message }
            : {}),
        }),
      })
    },
    withSpan(name, attributes, operation, options) {
      const link = options?.link ? spanContext(options.link) : undefined
      return tracer.startActiveSpan(
        name,
        {
          attributes: sanitizeAttributes(attributes),
          links: link ? [{ context: link }] : [],
        },
        async (span) => {
          try {
            return await operation()
          } catch (error) {
            const normalized = normalizedError(error)
            span.recordException(new Error(normalized.message))
            span.setAttribute("error.type", normalized.type)
            span.setStatus({ code: SpanStatusCode.ERROR })
            throw error
          } finally {
            span.end()
          }
        }
      )
    },
    count(name, value = 1, attributes = {}) {
      const counter = counters.get(name) ?? meter.createCounter(name)
      counters.set(name, counter)
      counter.add(value, sanitizeAttributes(attributes))
    },
    measure(name, value, attributes = {}) {
      const histogram = histograms.get(name) ?? meter.createHistogram(name)
      histograms.set(name, histogram)
      histogram.record(value, sanitizeAttributes(attributes))
    },
    gauge(name, value, attributes = {}) {
      const gauge = gauges.get(name) ?? meter.createGauge(name)
      gauges.set(name, gauge)
      gauge.record(value, sanitizeAttributes(attributes))
    },
    captureContext,
    shutdown: () => sdk.shutdown(),
  }
}

function captureContext(): TraceContext | undefined {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return carrier.traceparent
    ? {
        traceParent: carrier.traceparent,
        ...(carrier.tracestate ? { traceState: carrier.tracestate } : {}),
      }
    : undefined
}

function spanContext(value: TraceContext): SpanContext | undefined {
  const extracted = propagation.extract(context.active(), {
    traceparent: value.traceParent,
    ...(value.traceState ? { tracestate: value.traceState } : {}),
  })
  return trace.getSpanContext(extracted)
}

function signalUrl(endpoint: string, signal: "logs" | "metrics" | "traces") {
  return `${endpoint.replace(/\/$/, "")}/v1/${signal}`
}

function parseHeaders(value?: string): Record<string, string> {
  return Object.fromEntries(
    (value ?? "")
      .split(",")
      .map((header) => header.trim())
      .filter(Boolean)
      .map((header) => {
        const separator = header.indexOf("=")
        if (separator < 1) throw new Error("Invalid OTLP header")
        return [header.slice(0, separator), header.slice(separator + 1)]
      })
  )
}

function severityNumber(level: TelemetryEvent["level"]): SeverityNumber {
  if (level === "error") return SeverityNumber.ERROR
  if (level === "warn") return SeverityNumber.WARN
  if (level === "debug") return SeverityNumber.DEBUG
  return SeverityNumber.INFO
}
