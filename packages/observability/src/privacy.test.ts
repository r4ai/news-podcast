import { describe, expect, it } from "vitest"

import {
  normalizedError,
  sanitizeAttributes,
  sanitizeMetricAttributes,
} from "./privacy.js"

describe("observability privacy boundary", () => {
  it("keeps only the telemetry attribute allowlist", () => {
    expect(
      sanitizeAttributes({
        "service.name": "api",
        "operation.stage": "rss",
        "job.id": "opaque-job-id",
        "provider.operation": "synthesis",
        "user.id": "private-user",
        "rss.url": "https://example.com/private",
      })
    ).toEqual({
      "service.name": "api",
      "operation.stage": "rss",
      "job.id": "opaque-job-id",
      "provider.operation": "synthesis",
    })
  })

  it("normalizes errors without URLs, email addresses, or secrets", () => {
    const result = normalizedError(
      new TypeError(
        "request https://private.example failed for user@example.com Bearer abcdefghijklmnop"
      )
    )
    expect(result).toEqual({
      type: "TypeError",
      message: "request [url] failed for [email] [secret]",
    })
  })

  it("redacts every supported credential form at the central attribute boundary", () => {
    const message = [
      "Authorization: Basic dXNlcjpwYXNz",
      "x-api-key=private-api-key",
      "password=hunter2",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
    ].join(" ")

    expect(sanitizeAttributes({ "error.message": message })).toEqual({
      "error.message":
        "Authorization: [secret] x-api-key=[secret] password=[secret] [secret] [secret]",
    })
    expect(normalizedError(new Error(message)).message).toBe(
      "Authorization: [secret] x-api-key=[secret] password=[secret] [secret] [secret]"
    )
  })

  it("physically strips high-cardinality and content attributes from metrics", () => {
    expect(
      sanitizeMetricAttributes({
        "job.id": "must-not-be-a-metric-label",
        "error.message": "unbounded content",
        "rss.url": "https://example.com/private",
        "job.attempt": 2,
        "operation.stage": "synthesizing_audio",
        "provider.outcome": "timeout",
      })
    ).toEqual({
      "job.attempt": 2,
      "operation.stage": "synthesizing_audio",
      "provider.outcome": "timeout",
    })
  })
})
