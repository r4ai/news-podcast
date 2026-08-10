import { describe, expect, it } from "vitest"
import { SpanKind } from "@opentelemetry/api"
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs"
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics"
import {
  InMemorySpanExporter,
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"

import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "./node-adapter.js"

describe("Node observability configuration", () => {
  it("keeps telemetry disabled without requiring an endpoint", () => {
    expect(readNodeObservabilityConfig({}, "api")).toMatchObject({
      enabled: false,
      serviceName: "api",
      traceSampleRate: 0.2,
    })
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
})
