import { describe, expect, it } from "vitest"

import { watchdogTargets } from "./config.js"

describe("watchdogTargets", () => {
  it("adds observed Grafana and Collector as named targets", () => {
    const targets = watchdogTargets({
      WATCHDOG_GRAFANA_URL: "http://grafana:3000/api/health",
      WATCHDOG_COLLECTOR_URL: "http://otel-collector:13133/",
    })

    expect(targets).toContainEqual({
      name: "grafana",
      url: "http://grafana:3000/api/health",
    })
    expect(targets).toContainEqual({
      name: "otel-collector",
      url: "http://otel-collector:13133/",
    })
  })
})
