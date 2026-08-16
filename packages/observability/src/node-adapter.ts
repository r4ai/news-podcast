import {
  context,
  metrics,
  propagation,
  type Counter,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import {
  HttpInstrumentation,
  type HttpInstrumentationConfig,
} from "@opentelemetry/instrumentation-http"
import {
  UndiciInstrumentation,
  type UndiciInstrumentationConfig,
} from "@opentelemetry/instrumentation-undici"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  BatchLogRecordProcessor,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs"
import {
  type MetricReader,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics"
import { NodeSDK } from "@opentelemetry/sdk-node"
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  type Sampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base"
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_URL_FULL,
  ATTR_URL_QUERY,
} from "@opentelemetry/semantic-conventions"
import type { RequestOptions } from "node:http"

import type {
  MetricName,
  Observability,
  SpanOptions,
  TelemetryEvent,
  TraceContext,
} from "./contract.js"
import { noopObservability } from "./noop-adapter.js"
import {
  normalizedError,
  sanitizeAttributes,
  sanitizeMetricAttributes,
} from "./privacy.js"
import {
  makeAllowlistTextMapPropagator,
  installPropagationGate,
  readPropagationAllowlist,
} from "./propagation.js"
import { extractRemoteContext, extractRemoteSpanContext } from "./w3c.js"

export interface NodeObservabilityConfig {
  readonly enabled: boolean
  readonly endpoint?: string
  readonly headers?: string
  readonly serviceName: string
  readonly serviceVersion: string
  readonly environment: string
  readonly traceSampleRate: number
  /** HTTP/undiciの自動計装とallowlist伝播ゲートを有効化する（既定 true）。 */
  readonly autoInstrumentation: boolean
  /** 自動計装の伝播先allowlist。環境変数 OTEL_PROPAGATION_ALLOWLIST から読む。 */
  readonly propagationAllowlist: ReadonlySet<string>
}

export interface NodeObservabilityDependencies {
  readonly tracer?: Tracer
  readonly metricExporter?: PushMetricExporter
  readonly logExporter?: LogRecordExporter
  /** テスト用の注入シーム。指定時はPeriodicExportingMetricReaderの代わりに使う。 */
  readonly metricReader?: MetricReader
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
  const traceSampleRate = Number(environment.OTEL_TRACE_SAMPLE_RATE ?? "1")
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
    autoInstrumentation: environment.OTEL_AUTO_INSTRUMENTATION !== "false",
    propagationAllowlist: readPropagationAllowlist(environment),
  }
}

export function createNodeObservability(
  config: NodeObservabilityConfig,
  dependencies: NodeObservabilityDependencies = {}
): Observability {
  if (!config.enabled || !config.endpoint) return noopObservability

  const headers = parseHeaders(config.headers)
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    "telemetry.schema.version": "1",
  })
  const instrumentations = config.autoInstrumentation
    ? [
        new HttpInstrumentation(createHttpInstrumentationConfig(config)),
        new UndiciInstrumentation(createUndiciInstrumentationConfig(config)),
      ]
    : []
  const sdk = new NodeSDK({
    resource,
    instrumentations,
    ...(config.autoInstrumentation
      ? { textMapPropagator: makeAllowlistTextMapPropagator() }
      : {}),
    traceExporter: new OTLPTraceExporter({
      url: signalUrl(config.endpoint, "traces"),
      headers,
    }),
    metricReader:
      dependencies.metricReader ??
      new PeriodicExportingMetricReader({
        exporter:
          dependencies.metricExporter ??
          new OTLPMetricExporter({
            url: signalUrl(config.endpoint, "metrics"),
            headers,
          }),
        exportIntervalMillis: 30_000,
      }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter:
          dependencies.logExporter ??
          new OTLPLogExporter({
            url: signalUrl(config.endpoint, "logs"),
            headers,
          }),
      }),
    ],
    sampler: createNodeSampler(config.traceSampleRate),
  })
  sdk.start()

  if (config.autoInstrumentation) {
    // 自動計装がpatchした後のグローバルを包み、非allowlist宛先では注入を止める。
    installPropagationGate(config.propagationAllowlist)
  }

  const tracer =
    dependencies.tracer ??
    trace.getTracer(config.serviceName, config.serviceVersion)
  const logger = logs.getLogger(config.serviceName, config.serviceVersion)
  const meter = metrics.getMeter(config.serviceName, config.serviceVersion)
  const counters = new Map<MetricName, Counter>()
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
      const parent = options?.parent
        ? extractRemoteContext(options.parent)
        : context.active()
      const link = options?.link
        ? extractRemoteSpanContext(options.link)
        : undefined
      return tracer.startActiveSpan(
        name,
        {
          attributes: sanitizeAttributes(attributes),
          links: link ? [{ context: link }] : [],
          kind: spanKind(options?.kind),
        },
        parent,
        async (span) => {
          try {
            return await operation()
          } catch (error) {
            recordErrorOnSpan(span, error)
            throw error
          } finally {
            span.end()
          }
        }
      )
    },
    withGuaranteedSpan(name, operation, attributes = {}) {
      const synthesized = trace.getActiveSpan() === undefined
      if (synthesized) {
        const metricCounter =
          counters.get("trace.entry.synthesized") ??
          meter.createCounter("trace.entry.synthesized")
        counters.set("trace.entry.synthesized", metricCounter)
        metricCounter.add(
          1,
          sanitizeMetricAttributes({
            "trace.entry.synthesized": true,
            "operation.stage": name,
          })
        )
      }
      return tracer.startActiveSpan(
        name,
        {
          attributes: sanitizeAttributes({
            ...attributes,
            ...(synthesized ? { "trace.entry.synthesized": true } : {}),
          }),
        },
        async (span) => {
          try {
            return await operation()
          } catch (error) {
            recordErrorOnSpan(span, error)
            throw error
          } finally {
            span.end()
          }
        }
      )
    },
    assertActiveSpan(name) {
      // 本番では欠落をエラーで妨げず、synthesizedカウンタとruleで監視する。
      if (config.environment === "production") return
      if (trace.getActiveSpan() === undefined) {
        throw new Error(
          `No active span for ${name}: automatic instrumentation is not loaded`
        )
      }
    },
    count(name, value = 1, attributes = {}) {
      const counter = counters.get(name) ?? meter.createCounter(name)
      counters.set(name, counter)
      counter.add(value, sanitizeMetricAttributes(attributes))
    },
    measure(name, value, attributes = {}) {
      const histogram = histograms.get(name) ?? meter.createHistogram(name)
      histograms.set(name, histogram)
      histogram.record(value, sanitizeMetricAttributes(attributes))
    },
    gauge(name, value, attributes = {}) {
      const gauge = gauges.get(name) ?? meter.createGauge(name)
      gauges.set(name, gauge)
      gauge.record(value, sanitizeMetricAttributes(attributes))
    },
    captureContext,
    shutdown: () => sdk.shutdown(),
  }
}

export function createHttpInstrumentationConfig(
  config: NodeObservabilityConfig
): HttpInstrumentationConfig {
  const endpoint = config.endpoint ? new URL(config.endpoint) : undefined
  const isOtlpExport = (options: RequestOptions): boolean => {
    if (!endpoint) return false
    const host = (options.host ?? options.hostname ?? "")
      .split(":", 1)[0]!
      .toLowerCase()
    const path = options.path ?? ""
    return host === endpoint.hostname && path.startsWith("/v1/")
  }
  return {
    // Browser telemetryの再転送はserver spanにしない（ノイズ抑制）。
    ignoreIncomingRequestHook: (request) =>
      request.url?.startsWith("/v1/telemetry") ?? false,
    // telemetry自身のexportはclient spanにしない（自己計装の回避）。
    ignoreOutgoingRequestHook: isOtlpExport,
    requestHook: (span) => {
      span.setAttribute(ATTR_URL_QUERY, "")
    },
  }
}

export function createUndiciInstrumentationConfig(
  config: NodeObservabilityConfig
): UndiciInstrumentationConfig {
  return {
    // OTLP JSON exporters use fetch/Undici; tracing those requests would
    // turn telemetry transport into misleading business dependencies.
    ignoreRequestHook: (request) => isOtlpUndiciRequest(config, request),
    requestHook: (span, request) => {
      const url = new URL(request.path, request.origin)
      url.search = ""
      url.hash = ""
      span.setAttribute(ATTR_URL_FULL, url.toString())
      span.setAttribute(ATTR_URL_QUERY, "")
    },
  }
}

function isOtlpUndiciRequest(
  config: NodeObservabilityConfig,
  request: { readonly origin: string; readonly path: string }
): boolean {
  if (!config.endpoint) return false
  const endpoint = new URL(config.endpoint)
  return request.origin === endpoint.origin && request.path.startsWith("/v1/")
}

function recordErrorOnSpan(span: Span, error: unknown): void {
  const normalized = normalizedError(error)
  span.recordException(new Error(normalized.message))
  span.setAttribute("error.type", normalized.type)
  span.setAttribute("error.message", normalized.message)
  span.setStatus({ code: SpanStatusCode.ERROR })
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

function spanKind(kind: SpanOptions["kind"]): SpanKind {
  if (kind === "server") return SpanKind.SERVER
  if (kind === "client") return SpanKind.CLIENT
  if (kind === "producer") return SpanKind.PRODUCER
  if (kind === "consumer") return SpanKind.CONSUMER
  return SpanKind.INTERNAL
}

export * from "./node-client-fetch.js"

export function createNodeSampler(traceSampleRate: number): Sampler {
  const root =
    traceSampleRate === 1
      ? new AlwaysOnSampler()
      : new TraceIdRatioBasedSampler(traceSampleRate)
  return new ParentBasedSampler({ root, remoteParentNotSampled: root })
}
