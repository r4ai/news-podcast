import { describe, expect, it } from "vitest"

import { watchdogMetrics } from "./metrics.js"

describe("watchdog metrics", () => {
  it("exports target up, consecutive failures, and last success", () => {
    const metrics = watchdogMetrics(
      {
        failures: { api: "down" },
        targets: {
          api: {
            up: false,
            consecutiveFailures: 3,
            lastSuccessAt: "2026-08-15T00:00:00.000Z",
          },
        },
      },
      true,
      "2026-08-15T00:01:00.000Z"
    )
    expect(metrics).toContain('target_up{target="api"} 0')
    expect(metrics).toContain('target_consecutive_failures{target="api"} 3')
    expect(metrics).toContain("target_last_success_timestamp_seconds")
  })
})
