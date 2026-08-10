import { describe, expect, it } from "vitest"

import { normalizedError, sanitizeAttributes } from "./privacy.js"

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
})
