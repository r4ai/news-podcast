import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { decodePersistedJson, decodePersistedJsonSync } from "./json.js"

const PersistedOwnerSchema = Schema.Struct({
  ownerId: Schema.String.check(Schema.isPattern(/^owner-[1-9]\d*$/)),
})

describe("persisted JSON decoding", () => {
  it("strictly decodes and freezes a valid record", async () => {
    const decoded = await Effect.runPromise(
      decodePersistedJson(
        "episode.owner",
        PersistedOwnerSchema,
        '{"ownerId":"owner-1"}'
      )
    )

    expect(decoded).toEqual({ ownerId: "owner-1" })
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it.each([
    ["malformed", '{"ownerId":'],
    ["schema mismatch", '{"ownerId":"anonymous"}'],
    ["legacy excess field", '{"ownerId":"owner-1","legacy":true}'],
  ])("maps %s without persisted content in the failure", async (_, input) => {
    const exit = await Effect.runPromiseExit(
      decodePersistedJson("episode.owner", PersistedOwnerSchema, input)
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("DatabaseFailed")
      expect(String(exit.cause)).toContain("episode.owner")
      expect(String(exit.cause)).toContain("CorruptRecord")
      expect(String(exit.cause)).not.toContain(input)
    }
  })

  it("offers the same typed failure to synchronous adapter internals", () => {
    let failure: unknown
    try {
      decodePersistedJsonSync(
        "episode.owner",
        PersistedOwnerSchema,
        '{"ownerId":"anonymous"}'
      )
    } catch (cause) {
      failure = cause
    }

    expect(failure).toEqual({
      _tag: "DatabaseFailed",
      operation: "episode.owner",
      reason: "CorruptRecord",
    })
  })
})
