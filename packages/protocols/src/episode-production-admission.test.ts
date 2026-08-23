import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CreateEpisodeJobReplySchema,
  EpisodeJobControlReplySchema,
} from "./episode-production-rpc.js"

const activeJobId = "10e2d4e1-c127-479f-a124-2ea037bd9319"

describe("episode production admission replies", () => {
  it.each([
    ["create", CreateEpisodeJobReplySchema],
    ["retry", EpisodeJobControlReplySchema],
  ] as const)(
    "preserves the active job reference for %s conflicts",
    (_, schema) => {
      expect(
        Schema.decodeUnknownSync(schema)({
          _tag: "ActiveJobConflict",
          activeJobId,
        })
      ).toMatchObject({ _tag: "ActiveJobConflict", activeJobId })
    }
  )
})
