import { describe, expect, it } from "vitest"

import { sanitizeEventAttributes, sanitizeMetricEventAttributes } from "./otel"

describe("browser event telemetry attributes", () => {
  it("keeps bounded failure correlation in logs and traces", () => {
    expect(
      sanitizeEventAttributes({
        "failure.code": "job_deadline_exceeded",
        "job.id": "10e2d4e1-c127-479f-a124-2ea037bd9319",
        "episode.job.id": "non-canonical",
        secret: "must-not-leak",
      })
    ).toEqual({
      "failure.code": "job_deadline_exceeded",
      "job.id": "10e2d4e1-c127-479f-a124-2ea037bd9319",
    })
  })

  it("removes the high-cardinality job ID from metrics", () => {
    expect(
      sanitizeMetricEventAttributes({
        "failure.code": "job_deadline_exceeded",
        "job.id": "10e2d4e1-c127-479f-a124-2ea037bd9319",
      })
    ).toEqual({ "failure.code": "job_deadline_exceeded" })
  })
})
