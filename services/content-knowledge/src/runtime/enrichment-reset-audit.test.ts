import { describe, expect, it, vi } from "vitest"

import { makeEnrichmentResetAudit } from "./enrichment-reset-audit.js"

describe("enrichment reset audit", () => {
  it.each(["rejected", "succeeded"] as const)(
    "records the %s outcome without owner-cardinality metrics",
    (outcome) => {
      const count = vi.fn()
      const log = vi.fn()
      makeEnrichmentResetAudit({ count, log })({
        actorId: "owner-a",
        ownerId: "owner-a",
        environment: outcome === "rejected" ? "production" : "development",
        outcome,
        reason:
          outcome === "rejected"
            ? "server_policy_disabled"
            : "explicit_non_production_enablement",
      })

      expect(count).toHaveBeenCalledWith(
        "article.enrich.daily_reset",
        1,
        expect.not.objectContaining({ "owner.id": expect.anything() })
      )
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "article.enrich.daily_reset",
          attributes: expect.objectContaining({
            "actor.id": "owner-a",
            "owner.id": "owner-a",
            "operation.stage": outcome,
          }),
        })
      )
    }
  )
})
