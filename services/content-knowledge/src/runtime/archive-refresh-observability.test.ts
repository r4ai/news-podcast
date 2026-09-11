import { expect, it, vi } from "vitest"
import { makeArchiveRefreshObserver } from "./archive-refresh-observability.js"

it("measures wait distributions while counting outcomes and gauging queue depth", () => {
  const telemetry = {
    count: vi.fn(),
    gauge: vi.fn(),
    measure: vi.fn(),
    log: vi.fn(),
  }
  const observe = makeArchiveRefreshObserver(telemetry)
  observe({ event: "started", waitMillis: 125 })
  observe({ event: "queue", depth: { queued: 2, processing: 1, expired: 0 } })
  expect(telemetry.measure).toHaveBeenCalledWith("archive.refresh.wait", 125)
  expect(telemetry.count).toHaveBeenCalledWith("archive.refresh", 1, {
    outcome: "started",
    reason: "none",
  })
  expect(telemetry.gauge).toHaveBeenCalledWith("archive.refresh.jobs", 2, {
    state: "queued",
  })
})
