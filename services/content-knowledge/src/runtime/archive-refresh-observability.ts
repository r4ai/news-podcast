import type { Observability } from "@news-podcast/observability"
import type { ArchiveRefreshObservation } from "./loops/archive-refresh.js"

export const makeArchiveRefreshObserver =
  (observability: Pick<Observability, "count" | "gauge" | "measure" | "log">) =>
  (value: ArchiveRefreshObservation): void => {
    if (value.depth !== undefined) {
      for (const [state, depth] of Object.entries(value.depth))
        observability.gauge("archive.refresh.jobs", depth, { state })
      return
    }
    observability.count("archive.refresh", 1, {
      outcome: value.event,
      reason: value.reason ?? "none",
    })
    if (value.waitMillis !== undefined)
      observability.measure("archive.refresh.wait", value.waitMillis)
    observability.log({
      name: "archive.refresh",
      level:
        value.event === "rejected" ||
        value.event === "failed" ||
        value.event === "deadline"
          ? "warn"
          : "info",
      attributes: {
        outcome: value.event,
        reason: value.reason ?? "none",
        waitMillis: value.waitMillis ?? 0,
      },
    })
  }
