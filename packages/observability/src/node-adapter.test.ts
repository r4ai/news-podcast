import { describe, expect, it, beforeEach } from "vitest"
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  metrics,
  trace,
} from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs"
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics"
import {
  InMemorySpanExporter,
  BasicTracerProvider,
  SamplingDecision,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"

import {
  createHttpInstrumentationConfig,
  createNodeObservability,
  createNodeSampler,
  createUndiciInstrumentationConfig,
  readNodeObservabilityConfig,
} from "./node-adapter.js"

// OTelのsetGlobal*Providerは「先勝ち」（既に登録済みなら無視）のため、
// 同一プロセス内で複数アダプタを作るテストでは都度グローバルをリセットする。
function resetGlobalProviders(): void {
  logs.disable()
  metrics.disable()
  trace.disable()
}

describe("Node observability configuration", () => {
  beforeEach(resetGlobalProviders)
  it("keeps telemetry disabled without requiring an endpoint", () => {
    expect(readNodeObservabilityConfig({}, "api")).toMatchObject({
      enabled: false,
      serviceName: "api",
      traceSampleRate: 1,
    })
  })

  it("samples backend roots even when a browser parent was not sampled", () => {
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 0,
      isRemote: true,
    })

    expect(
      createNodeSampler(1).shouldSample(
        parent,
        "4bf92f3577b34da6a3ce929d0e0e4736",
        "GET /health",
        SpanKind.SERVER,
        {},
        []
      ).decision
    ).toBe(SamplingDecision.RECORD_AND_SAMPLED)
  })

  it("requires an endpoint and a valid sampling ratio when enabled", () => {
    expect(() =>
      readNodeObservabilityConfig({ OTEL_ENABLED: "true" }, "api")
    ).toThrow("OTEL_EXPORTER_OTLP_ENDPOINT")
    expect(() =>
      readNodeObservabilityConfig(
        {
          OTEL_ENABLED: "true",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
          OTEL_TRACE_SAMPLE_RATE: "2",
        },
        "api"
      )
    ).toThrow("OTEL_TRACE_SAMPLE_RATE")
  })

  it("removes all query values from automatic HTTP and Undici spans", () => {
    const attributes: Record<string, unknown> = {}
    const span = {
      setAttribute(name: string, value: unknown) {
        attributes[name] = value
        return this
      },
    }
    const config = {
      enabled: true,
      endpoint: "http://collector:4318",
      serviceName: "test",
      serviceVersion: "test",
      environment: "test",
      traceSampleRate: 1,
      autoInstrumentation: true,
      propagationAllowlist: new Set<string>(),
    }

    createHttpInstrumentationConfig(config).requestHook?.(
      span as never,
      {
        url: "/api/auth/callback/google?code=oauth-code&state=oauth-state",
      } as never
    )
    expect(attributes).toMatchObject({ "url.query": "" })

    createUndiciInstrumentationConfig(config).requestHook?.(
      span as never,
      {
        origin: "https://feeds.example",
        path: "/private.xml?access_token=private-feed-token",
      } as never
    )
    expect(attributes).toMatchObject({
      "url.full": "https://feeds.example/private.xml",
      "url.query": "",
    })
    expect(JSON.stringify(attributes)).not.toContain("oauth-code")
    expect(JSON.stringify(attributes)).not.toContain("oauth-state")
    expect(JSON.stringify(attributes)).not.toContain("private-feed-token")
  })

  it("continues remote parents and links independent worker traces", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      {
        tracer: tracerProvider.getTracer("test"),
        metricExporter: new InMemoryMetricExporter(
          AggregationTemporality.CUMULATIVE
        ),
        logExporter: new InMemoryLogRecordExporter(),
      }
    )
    let apiContext
    await observability.withSpan(
      "http.request",
      {},
      async () => {
        apiContext = observability.captureContext()
      },
      {
        parent: {
          traceParent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      }
    )
    expect(apiContext).toBeDefined()
    await observability.withSpan(
      "episode.process",
      {},
      () =>
        observability.withSpan(
          "provider.s3.put",
          { "provider.name": "s3", "provider.operation": "put" },
          () => Promise.resolve(),
          { kind: "client" }
        ),
      { link: apiContext! }
    )

    const finishedSpans = traceExporter.getFinishedSpans()
    expect(finishedSpans.map((span) => span.name)).toEqual([
      "http.request",
      "provider.s3.put",
      "episode.process",
    ])
    const apiSpan = finishedSpans.find((span) => span.name === "http.request")!
    const workerSpan = finishedSpans.find(
      (span) => span.name === "episode.process"
    )!
    const providerSpan = finishedSpans.find(
      (span) => span.name === "provider.s3.put"
    )!
    expect(apiSpan.spanContext().traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    )
    expect(apiSpan.parentSpanContext?.spanId).toBe("00f067aa0ba902b7")
    expect(workerSpan.spanContext().traceId).not.toBe(
      apiSpan.spanContext().traceId
    )
    expect(workerSpan.links[0]?.context).toMatchObject({
      traceId: apiSpan.spanContext().traceId,
      spanId: apiSpan.spanContext().spanId,
    })
    expect(providerSpan.spanContext().traceId).toBe(
      workerSpan.spanContext().traceId
    )
    expect(providerSpan.parentSpanContext?.spanId).toBe(
      workerSpan.spanContext().spanId
    )
    expect(providerSpan.kind).toBe(SpanKind.CLIENT)
    await tracerProvider.shutdown()
    await observability.shutdown()
  })

  it("emits the redacted error message on logs and failing spans", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const logExporter = new InMemoryLogRecordExporter()
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      {
        tracer: tracerProvider.getTracer("test"),
        logExporter,
      }
    )

    await expect(
      observability.withSpan("episode.process", {}, async () => {
        throw new TypeError("request https://private.example failed")
      })
    ).rejects.toThrow("request https://private.example failed")
    observability.log({
      name: "episode.failed",
      level: "error",
      error: new Error("boom https://private.example"),
    })
    await (
      logs.getLoggerProvider() as unknown as {
        forceFlush(): Promise<void>
      }
    ).forceFlush()

    const [span] = traceExporter.getFinishedSpans()
    expect(span).toMatchObject({
      name: "episode.process",
      status: { code: SpanStatusCode.ERROR },
      attributes: {
        "error.type": "TypeError",
        "error.message": "request [url] failed",
      },
    })
    const [log] = logExporter.getFinishedLogRecords()
    expect(log.body).toBe("episode.failed")
    expect(log.attributes).toMatchObject({
      "error.type": "Error",
      "error.message": "boom [url]",
    })
    expect(log.attributes).not.toHaveProperty("error.stack")
    await tracerProvider.shutdown()
    await observability.shutdown()
  })

  it("retains bounded script quality dimensions after adapter sanitization", async () => {
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    )
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    })
    const logExporter = new InMemoryLogRecordExporter()
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      { metricReader, logExporter }
    )
    const attributes = {
      "gen_ai.request.model": "gpt-5.6-luna",
      "episode.script.prompt.version": "episode-script-v2",
      "episode.script.quality_prompt.version": "episode-script-quality-v1",
      "quality.outcome": "reject",
      "quality.reason": "prompt_injection",
      "article.body": "must-never-be-exported",
    }

    observability.count("episode.script.quality", 1, attributes)
    observability.log({
      name: "episode.script.quality_evaluated",
      attributes,
    })
    const collected = await metricReader.collect()
    await (
      logs.getLoggerProvider() as unknown as {
        forceFlush(): Promise<void>
      }
    ).forceFlush()

    const metric = collected.resourceMetrics.scopeMetrics
      .flatMap(({ metrics }) => metrics)
      .find(
        (candidate) => candidate.descriptor.name === "episode.script.quality"
      )
    expect(metric?.dataPoints[0]?.attributes).toEqual({
      "gen_ai.request.model": "gpt-5.6-luna",
      "episode.script.prompt.version": "episode-script-v2",
      "episode.script.quality_prompt.version": "episode-script-quality-v1",
      "quality.outcome": "reject",
      "quality.reason": "prompt_injection",
    })
    expect(logExporter.getFinishedLogRecords()[0]?.attributes).toEqual({
      "gen_ai.request.model": "gpt-5.6-luna",
      "episode.script.prompt.version": "episode-script-v2",
      "episode.script.quality_prompt.version": "episode-script-quality-v1",
      "quality.outcome": "reject",
      "quality.reason": "prompt_injection",
    })
    await metricReader.shutdown()
    await observability.shutdown()
  })

  it("correlates logs with the active trace and models every service boundary kind", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const logExporter = new InMemoryLogRecordExporter()
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      { tracer: tracerProvider.getTracer("test"), logExporter }
    )

    for (const kind of ["server", "producer", "consumer"] as const) {
      await observability.withSpan(
        `boundary.${kind}`,
        {},
        async () => observability.log({ name: "api.request" }),
        { kind }
      )
    }
    await (
      logs.getLoggerProvider() as unknown as {
        forceFlush(): Promise<void>
      }
    ).forceFlush()

    expect(traceExporter.getFinishedSpans().map((span) => span.kind)).toEqual([
      SpanKind.SERVER,
      SpanKind.PRODUCER,
      SpanKind.CONSUMER,
    ])
    expect(
      logExporter
        .getFinishedLogRecords()
        .map((record) => record.spanContext)
        .every((spanContext) =>
          traceExporter
            .getFinishedSpans()
            .some(
              (span) =>
                span.spanContext().traceId === spanContext?.traceId &&
                span.spanContext().spanId === spanContext.spanId
            )
        )
    ).toBe(true)
    await tracerProvider.shutdown()
    await observability.shutdown()
  })

  it("retains low-cardinality semantic attributes needed by service graphs", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      { tracer: tracerProvider.getTracer("test") }
    )

    await observability.withSpan(
      "nats.publish",
      {
        "messaging.system": "nats",
        "messaging.destination.name": "episode.requested.v1",
        "messaging.operation.type": "publish",
        "server.address": "nats",
      },
      async () => undefined,
      { kind: "producer" }
    )

    expect(traceExporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      "messaging.system": "nats",
      "messaging.destination.name": "episode.requested.v1",
      "messaging.operation.type": "publish",
      "server.address": "nats",
    })
    await tracerProvider.shutdown()
    await observability.shutdown()
  })

  it("guarantees a root span for non-HTTP entry points and reuses active parents", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    )
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    })
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      {
        tracer: tracerProvider.getTracer("test"),
        metricReader,
      }
    )

    await observability.withGuaranteedSpan("worker.tick", async () => {
      await observability.withGuaranteedSpan("rss.sync", async () => undefined)
    })

    const spans = traceExporter.getFinishedSpans()
    const root = spans.find((span) => span.name === "worker.tick")!
    const child = spans.find((span) => span.name === "rss.sync")!
    expect(root).toMatchObject({
      attributes: { "trace.entry.synthesized": true },
    })
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    expect(child.attributes).not.toHaveProperty("trace.entry.synthesized")

    await metricReader.collect()
    const synthesized = metricExporter
      .getMetrics()
      .flatMap((metric) =>
        metric.scopeMetrics.flatMap(({ metrics }) => metrics)
      )
      .find((metric) => metric.descriptor.name === "trace.entry.synthesized")
    expect(synthesized).toBeUndefined()
    const collected = await metricReader.collect()
    const collectedSynthesized = collected.resourceMetrics.scopeMetrics
      .flatMap(({ metrics }) => metrics)
      .find((metric) => metric.descriptor.name === "trace.entry.synthesized")
    expect(collectedSynthesized).toBeDefined()
    await metricReader.shutdown()
    await tracerProvider.shutdown()
    await observability.shutdown()
  })

  it("asserts an active span exists when instrumentation is loaded", async () => {
    const traceExporter = new InMemorySpanExporter()
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    })
    const observability = createNodeObservability(
      {
        enabled: true,
        endpoint: "http://unused.test",
        serviceName: "test",
        serviceVersion: "test",
        environment: "test",
        traceSampleRate: 1,
        autoInstrumentation: false,
        propagationAllowlist: new Set<string>(),
      },
      { tracer: tracerProvider.getTracer("test") }
    )

    expect(() => observability.assertActiveSpan("http.request")).toThrow(
      /No active span/
    )
    await observability.withSpan("http.request", {}, async () => {
      expect(() => observability.assertActiveSpan("http.request")).not.toThrow()
    })
    await tracerProvider.shutdown()
    await observability.shutdown()
  })
})
