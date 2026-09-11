import { expect, it, vi } from "vitest"
import { makeFeedSyncObserver } from "./feed-sync-observability.js"
it("records wait and duration distributions and bounded outcomes without owner or URL labels", () => {
  const telemetry = { count: vi.fn(), measure: vi.fn(), log: vi.fn() }
  makeFeedSyncObserver(telemetry)({
    event: "budget",
    durationMillis: 45000,
    queuedAgeMillis: 55,
    processed: 1,
    deferred: 10,
  })
  expect(telemetry.count).toHaveBeenCalledWith("rss.sync.batch", 1, {
    outcome: "budget",
  })
  expect(telemetry.measure).toHaveBeenCalledWith("rss.sync.duration", 45000)
  expect(telemetry.measure).toHaveBeenCalledWith("rss.sync.queued_age", 55)
  expect(telemetry.measure).toHaveBeenCalledWith("rss.sync.deferred", 10)
})
