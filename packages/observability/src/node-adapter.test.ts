import { describe, expect, it } from "vitest"

import { readNodeObservabilityConfig } from "./node-adapter.js"

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
})
