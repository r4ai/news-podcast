import { describe, expect, it, vi } from "vitest"

import { metricNames, telemetryEventNames } from "./contract.js"
import { noopObservability } from "./noop-adapter.js"

describe("observability contract", () => {
  it("keeps event and metric names explicit", () => {
    expect(new Set(telemetryEventNames).size).toBe(telemetryEventNames.length)
    expect(new Set(metricNames).size).toBe(metricNames.length)
    expect(telemetryEventNames).toContain("episode.failed")
    expect(metricNames).toContain("http.server.duration")
  })

  it("executes application work through the no-op adapter", async () => {
    const operation = vi.fn().mockResolvedValue("completed")
    await expect(
      noopObservability.withSpan("test", {}, operation)
    ).resolves.toBe("completed")
    expect(operation).toHaveBeenCalledOnce()
    expect(noopObservability.captureContext()).toBeUndefined()
    await expect(noopObservability.shutdown()).resolves.toBeUndefined()
  })
})
