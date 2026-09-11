import type { Observability } from "@news-podcast/observability"
import type { FeedSyncObservation } from "../application/feed-sync-worker.js"

export const makeFeedSyncObserver =
  (telemetry: Pick<Observability, "count" | "measure" | "log">) =>
  (value: FeedSyncObservation): void => {
    telemetry.count("rss.sync.batch", 1, { outcome: value.event })
    telemetry.measure("rss.sync.duration", value.durationMillis)
    telemetry.measure("rss.sync.queued_age", value.queuedAgeMillis)
    telemetry.count("rss.sync.items", value.processed, { state: "processed" })
    telemetry.measure("rss.sync.deferred", value.deferred)
    telemetry.log({
      name: "rss.sync.batch",
      level: value.event === "completed" ? "info" : "warn",
      attributes: { ...value },
    })
  }
