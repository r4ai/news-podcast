import type { Observability } from "@news-podcast/observability"

import type { EnrichmentResetAuditEvent } from "./rpc/personalization.js"

type EnrichmentResetTelemetry = Pick<Observability, "count" | "log">

export const makeEnrichmentResetAudit =
  (observability: EnrichmentResetTelemetry) =>
  (event: EnrichmentResetAuditEvent): void => {
    observability.count("article.enrich.daily_reset", 1, {
      "deployment.environment": event.environment,
      "operation.stage": event.outcome,
      "failure.reason": event.reason,
    })
    observability.log({
      name: "article.enrich.daily_reset",
      level: event.outcome === "succeeded" ? "info" : "warn",
      attributes: {
        "actor.id": event.actorId,
        "owner.id": event.ownerId,
        "deployment.environment": event.environment,
        "operation.stage": event.outcome,
        "failure.reason": event.reason,
      },
    })
  }
