import type { Observability } from "@news-podcast/observability"

import type {
  ArchiveObjectCleanupOutcome,
  HttpS3ArticleCaptureObserver,
} from "../infrastructure/unsafe/http-s3-article-capture.js"

type ArchiveCleanupTelemetry = Pick<Observability, "count" | "log">

export const makeArchiveCleanupObserver = (
  observability: ArchiveCleanupTelemetry
): HttpS3ArticleCaptureObserver => ({
  linkCard: (outcome) =>
    observability.count("archive.link_card", 1, { result: outcome }),
  assets: (outcome) => {
    observability.count("archive.assets.attempted", outcome.attempted)
    observability.count(
      "archive.assets.downloaded_bytes",
      outcome.downloadedBytes
    )
    observability.count("archive.assets.retained_bytes", outcome.retainedBytes)
    if (outcome.limit !== "none")
      observability.count("archive.assets.limit", 1, { reason: outcome.limit })
    observability.log({
      name: "archive.assets.budget",
      level: outcome.limit === "none" ? "info" : "warn",
      attributes: {
        attempted: outcome.attempted,
        downloadedBytes: outcome.downloadedBytes,
        retainedBytes: outcome.retainedBytes,
        limit: outcome.limit,
      },
    })
  },
  cleanup: (outcome: ArchiveObjectCleanupOutcome) => {
    observability.count("object.cleanup", outcome.deleted, {
      "cleanup.result": "deleted",
      trigger: outcome.trigger,
    })
    observability.count("object.cleanup", outcome.failed, {
      "cleanup.result": "failed",
      trigger: outcome.trigger,
    })
    observability.log({
      name:
        outcome.failed === 0
          ? "object.cleanup.succeeded"
          : "object.cleanup.failed",
      level: outcome.failed === 0 ? "info" : "warn",
      attributes: {
        trigger: outcome.trigger,
        "cleanup.attempted": outcome.attempted,
        "cleanup.deleted": outcome.deleted,
        "cleanup.failed": outcome.failed,
      },
    })
  },
})
