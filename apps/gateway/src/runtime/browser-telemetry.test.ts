import { describe, expect, it } from "vitest"
import fixtures from "./browser-telemetry.sdk-fixtures.json" with { type: "json" }
import {
  InvalidBrowserTelemetry,
  sanitizeBrowserTelemetry,
} from "./browser-telemetry.js"

// Captured from the installed OTLP HTTP exporters 0.221.0 and SDK 2.10.0.
// Node and browser exports use the same Json*Serializer.
describe("browser OTLP allowlist", () => {
  it.each(["route.error", "panel.error"])(
    "classifies caught %s spans as browser errors",
    (name) => {
      const input = structuredClone(fixtures.traces)
      const span = input.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
      span.name = name
      span.status.code = 0
      expect(
        JSON.stringify(sanitizeBrowserTelemetry("traces", input))
      ).toContain('"status":{"code":2}')
    }
  )

  it("preserves the finite subscription action in every signal", () => {
    const input = structuredClone(fixtures)
    const attributes = [
      { key: "action", value: { stringValue: "add" } },
      { key: "action", value: { stringValue: "private-value" } },
    ]
    input.traces.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes =
      attributes
    input.logs.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes =
      attributes
    input.metrics.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.sum!.dataPoints[0]!.attributes =
      attributes
    for (const signal of ["traces", "logs", "metrics"] as const) {
      const output = JSON.stringify(
        sanitizeBrowserTelemetry(signal, input[signal])
      )
      expect(output).toContain('"key":"action","value":{"stringValue":"add"}')
      expect(output).not.toContain("private-value")
    }
  })

  it.each(["logs", "traces", "metrics"] as const)(
    "preserves actual SDK %s payloads",
    (signal) => {
      const safe = sanitizeBrowserTelemetry(signal, fixtures[signal])
      const json = JSON.stringify(safe)
      expect(json).toContain('"telemetry.trust"')
      expect(json).toContain('"untrusted"')
      expect(json).not.toContain("example.test")
      expect(json).toContain(
        signal === "metrics" ? "browser.web_vital" : "episode.requested"
      )
    }
  )

  it("drops nested data, status text, scope/resource labels and unbounded error names", () => {
    const input = structuredClone(fixtures.traces)
    const span = input.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    Object.assign(span, {
      status: { code: 2, message: "secret-status" },
      events: [{ name: "secret-event" }],
      links: [{ attributes: [{ key: "secret-link" }] }],
      attributes: [
        { key: "service.name", value: { stringValue: "episode-production" } },
        { key: "error.type", value: { stringValue: "private-error-text" } },
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "http.request.method", value: { stringValue: "POST" } },
        {
          key: "arbitrary",
          value: { kvlistValue: { values: [{ key: "secret-map" }] } },
        },
      ],
    })
    const json = JSON.stringify(sanitizeBrowserTelemetry("traces", input))
    expect(json).toContain("UnknownError")
    expect(json).toContain("POST")
    for (const text of ["secret-", "episode-production", "private-error-text"])
      expect(json).not.toContain(text)
  })

  it.each([
    "FORGED_BODY",
    { kvlistValue: { values: [] } },
    { arrayValue: { values: [] } },
  ])("rejects arbitrary log bodies (%#)", (body) => {
    const input = structuredClone(fixtures.logs)
    Object.assign(input.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!, {
      body: typeof body === "string" ? { stringValue: body } : body,
    })
    expect(() => sanitizeBrowserTelemetry("logs", input)).toThrow(
      InvalidBrowserTelemetry
    )
  })

  it("rejects arbitrary metric names/bounds and erases exemplars/datapoint spoofing", () => {
    const input = structuredClone(fixtures.metrics)
    const metrics = input.resourceMetrics[0]!.scopeMetrics[0]!.metrics
    const counter = metrics[0]!
    counter.name = "episode.requested"
    expect(() => sanitizeBrowserTelemetry("metrics", input)).toThrow(
      InvalidBrowserTelemetry
    )
    counter.name = "browser.event"
    const point = counter.sum!.dataPoints[0]!
    Object.assign(point, {
      exemplars: [{ filteredAttributes: [{ key: "secret" }] }],
      attributes: [
        { key: "service.name", value: { stringValue: "episode-production" } },
        {
          key: "job.id",
          value: { stringValue: "10e2d4e1-c127-479f-a124-2ea037bd9319" },
        },
      ],
    })
    const safe = JSON.stringify(sanitizeBrowserTelemetry("metrics", input))
    expect(safe).not.toContain("episode-production")
    expect(safe).not.toContain("secret")
    expect(safe).not.toContain("job.id")
    metrics[1]!.histogram!.dataPoints[0]!.explicitBounds[0] = 0.123
    expect(() => sanitizeBrowserTelemetry("metrics", input)).toThrow(
      InvalidBrowserTelemetry
    )
  })

  it("bounds records across resources and validates malformed structures", () => {
    const input = structuredClone(fixtures.logs)
    const record = input.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!
    input.resourceLogs[0]!.scopeLogs[0]!.logRecords = Array.from(
      { length: 129 },
      () => record
    )
    expect(() => sanitizeBrowserTelemetry("logs", input)).toThrow(
      InvalidBrowserTelemetry
    )
    for (const value of [
      null,
      [],
      {},
      { resourceLogs: {} },
      { resourceLogs: [null] },
    ]) {
      expect(() => sanitizeBrowserTelemetry("logs", value)).toThrow(
        InvalidBrowserTelemetry
      )
    }
  })

  it("rejects invalid trace names, IDs, duration and numeric histogram values", () => {
    for (const replacement of [
      { name: "user-secret" },
      { traceId: "invalid" },
      { startTimeUnixNano: "NaN" },
      { endTimeUnixNano: "1" },
    ]) {
      const input = structuredClone(fixtures.traces)
      Object.assign(
        input.resourceSpans[0]!.scopeSpans[0]!.spans[0]!,
        replacement
      )
      expect(() => sanitizeBrowserTelemetry("traces", input)).toThrow(
        InvalidBrowserTelemetry
      )
    }
    const input = structuredClone(fixtures.metrics)
    input.resourceMetrics[0]!.scopeMetrics[0]!.metrics[1]!.histogram!.dataPoints[0]!.sum =
      -1
    expect(() => sanitizeBrowserTelemetry("metrics", input)).toThrow(
      InvalidBrowserTelemetry
    )
  })
})
