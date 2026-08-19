import type { Observability } from "@news-podcast/observability"

import type {
  ArchiveObjectCleanupOutcome,
  HttpS3ArticleCaptureObserver,
} from "../infrastructure/unsafe/http-s3-article-capture.js"

type ArchiveCleanupTelemetry = Pick<Observability, "count" | "log">

export const makeArchiveCleanupObserver = (
  observability: ArchiveCleanupTelemetry
): HttpS3ArticleCaptureObserver => ({
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
