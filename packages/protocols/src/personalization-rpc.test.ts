import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseContentPersonalizationRequest,
  parseIdentitySettingsRequest,
  parseReadingDictionaryRequest,
} from "./personalization-rpc.js"

type Decoder = (input: unknown) => Effect.Effect<unknown, unknown, never>
const invalidCases: readonly (readonly [unknown, Decoder])[] = [
  [{ operation: "Get", ownerId: "attacker" }, parseIdentitySettingsRequest],
  [
    { operation: "Create", surface: "NHK", reading: "nhk" },
    parseReadingDictionaryRequest,
  ],
  [
    { operation: "DeleteTag", tagId: "not-a-uuid" },
    parseContentPersonalizationRequest,
  ],
  [
    { operation: "ResetDailyEnrichment", localDate: "tomorrow" },
    parseContentPersonalizationRequest,
  ],
  [
    { operation: "ResetDailyEnrichment", localDate: "2026-02-30" },
    parseContentPersonalizationRequest,
  ],
]

describe("personalization RPC contracts", () => {
  it("accepts finite owner-implicit commands", async () => {
    await expect(
      Effect.runPromise(
        parseContentPersonalizationRequest({
          operation: "SetArticleTags",
          articleId: "123e4567-e89b-42d3-a456-426614174000",
          tagIds: ["123e4567-e89b-42d3-a456-426614174001"],
        })
      )
    ).resolves.toMatchObject({ operation: "SetArticleTags" })
    await expect(
      Effect.runPromise(parseIdentitySettingsRequest({ operation: "Get" }))
    ).resolves.toEqual({ operation: "Get" })
  })

  it.each(invalidCases)(
    "rejects malformed or caller-selected ownership: %o",
    async (candidate, decode) => {
      await expect(Effect.runPromise(decode(candidate))).rejects.toBeDefined()
    }
  )
})
