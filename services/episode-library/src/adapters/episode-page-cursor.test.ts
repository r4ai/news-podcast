import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  decodeEpisodePageCursor,
  encodeEpisodePageCursor,
} from "./episode-page-cursor.js"

const position = {
  createdAt: "2026-08-12T00:00:00.000Z" as never,
  episodeId: "8a76daf6-d3d7-47db-9644-228dc5328c84" as never,
}

describe("episode page cursor", () => {
  it("round-trips a canonical opaque keyset position", async () => {
    const cursor = encodeEpisodePageCursor(position)

    expect(cursor).not.toContain(position.createdAt)
    expect(await Effect.runPromise(decodeEpisodePageCursor(cursor))).toEqual(
      position
    )
  })

  it.each([
    ["empty", ""],
    ["invalid alphabet", "not+a+cursor"],
    ["invalid JSON", Buffer.from("not-json").toString("base64url")],
    [
      "unknown version",
      Buffer.from(JSON.stringify({ ...position, v: 2 })).toString("base64url"),
    ],
    [
      "malformed episode ID",
      Buffer.from(
        JSON.stringify({ ...position, v: 1, episodeId: "episode-1" })
      ).toString("base64url"),
    ],
    ["oversized", "a".repeat(513)],
  ])("rejects %s", async (_case, cursor) => {
    expect(
      (await Effect.runPromiseExit(decodeEpisodePageCursor(cursor)))._tag
    ).toBe("Failure")
  })
})
