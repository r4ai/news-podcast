import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ReadingDictionaryEntrySchema,
  ReadingDictionarySnapshotSchema,
  ReadingSourceSchema,
} from "./reading-dictionary.js"

const validEntry = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerId: "owner-a",
  surface: "GPT-5",
  reading: "ジーピーティーファイブ",
  accentType: 6,
  source: "manual",
  episodeJobId: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
} as const

describe("reading dictionary domain", () => {
  it.each([
    ["blank surface", { ...validEntry, surface: " " }],
    ["untrimmed surface", { ...validEntry, surface: " GPT-5" }],
    ["non-katakana reading", { ...validEntry, reading: "GPT five" }],
    ["negative accent", { ...validEntry, accentType: -1 }],
    ["oversized accent", { ...validEntry, accentType: 101 }],
    ["unknown source", { ...validEntry, source: "imported" }],
  ])("rejects %s", async (_case, candidate) => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(ReadingDictionaryEntrySchema)(candidate)
    )

    expect(exit._tag).toBe("Failure")
  })

  it("accepts only the declared source variants", () => {
    expect(Schema.decodeUnknownSync(ReadingSourceSchema)("manual")).toBe(
      "manual"
    )
    expect(Schema.decodeUnknownSync(ReadingSourceSchema)("ai_auto")).toBe(
      "ai_auto"
    )
  })

  it("requires a canonical, owner-bound snapshot fingerprint", async () => {
    const snapshot = {
      ownerId: "owner-a",
      fingerprint: "a".repeat(64),
      entries: [
        {
          surface: "GPT-5",
          reading: "ジーピーティーファイブ",
          accentType: 6,
        },
      ],
    }

    expect(
      Schema.decodeUnknownSync(ReadingDictionarySnapshotSchema)(snapshot)
    ).toEqual(snapshot)
    const malformed = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(ReadingDictionarySnapshotSchema)({
        ...snapshot,
        fingerprint: "A".repeat(64),
      })
    )
    expect(malformed._tag).toBe("Failure")
  })
})
