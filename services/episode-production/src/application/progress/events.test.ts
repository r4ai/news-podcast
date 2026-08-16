import { describe, expect, it } from "vitest"

import { runErrorEvent } from "./events.js"
import type { ProgressState } from "./model.js"

const state: ProgressState = {
  jobId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
  status: "retrying",
  attempt: 1,
  maxAttempts: 4,
  selectionMode: "automatic",
  selectedArticles: [],
}

describe("AG-UI progress events", () => {
  it("keeps different terminal errors in the same attempt independently idempotent", () => {
    const retry = runErrorEvent(state, "2026-08-16T00:00:00.000Z", {
      code: "provider_unavailable",
      retryable: true,
    })
    const canceled = runErrorEvent(
      { ...state, status: "canceled" },
      "2026-08-16T00:00:01.000Z",
      { code: "canceled", retryable: false }
    )

    expect(retry.eventKey).not.toBe(canceled.eventKey)
  })
})
