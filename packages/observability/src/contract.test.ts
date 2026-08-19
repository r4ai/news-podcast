import { describe, expect, it, vi } from "vitest"

import { metricNames, metricUnits, telemetryEventNames } from "./contract.js"
import { noopObservability } from "./noop-adapter.js"

describe("observability contract", () => {
  it("keeps event and metric names explicit", () => {
    expect(new Set(telemetryEventNames).size).toBe(telemetryEventNames.length)
    expect(new Set(metricNames).size).toBe(metricNames.length)
    expect(telemetryEventNames).toContain("episode.failed")
    expect(telemetryEventNames).toContain("article.enrich.summary.degraded")
    expect(telemetryEventNames).toContain("rss.sync.degraded")
    expect(telemetryEventNames).toContain(
      "episode_library.completion.redelivery_threshold_exceeded"
    )
    expect(telemetryEventNames).toContain(
      "episode_library.completion.discarded"
    )
    expect(telemetryEventNames).toContain("process.uncaught_exception")
    expect(metricNames).toContain("http.server.duration")
    expect(metricNames).toContain("trace.entry.synthesized")
    expect(metricNames).toContain("http.server.error")
    expect(metricNames).toContain("process.error")
    expect(Object.keys(metricUnits).sort()).toEqual([...metricNames].sort())
  })

  it("executes application work through the no-op adapter", async () => {
    const operation = vi.fn().mockResolvedValue("completed")
    await expect(
      noopObservability.withSpan("test", {}, operation)
    ).resolves.toBe("completed")
    expect(operation).toHaveBeenCalledOnce()
    expect(noopObservability.captureContext()).toBeUndefined()
    expect(noopObservability.gauge("episode.jobs", 0)).toBeUndefined()
    await expect(
      noopObservability.withGuaranteedSpan("worker.tick", operation)
    ).resolves.toBe("completed")
    expect(noopObservability.assertActiveSpan("http.request")).toBeUndefined()
    await expect(noopObservability.shutdown()).resolves.toBeUndefined()
  })
})
