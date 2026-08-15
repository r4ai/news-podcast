import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  makeEnrichmentSource,
  unavailableEnrichmentProvider,
} from "./enrichment.js"

describe("enrichment runtime boundaries", () => {
  it("fails closed when no production provider is configured", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(unavailableEnrichmentProvider.enrich({ secret: "ignored" }))
    )

    expect(failure).toEqual({
      _tag: "EnrichmentProviderFailed",
      reason: "Permanent",
      message: "enrichment provider unavailable",
    })
  })

  it("enforces the application character limit after bounded object read", async () => {
    const source = makeEnrichmentSource({
      read: () => Effect.succeed("12345"),
    })

    expect(
      await Effect.runPromise(
        Effect.flip(source.read("object/key" as never, 4))
      )
    ).toEqual({
      _tag: "EnrichmentSourceFailed",
      reason: "ResourceLimit",
    })
  })
})
