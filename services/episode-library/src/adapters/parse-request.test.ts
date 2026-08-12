import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseGetCompletedEpisodeInput,
  parseIssueAudioAccessInput,
  parseListCompletedEpisodesInput,
} from "./parse-request.js"

const ownerId = "339cdfd7-7823-4ac6-82ce-3d56cab7acfa"
const episodeId = "8a76daf6-d3d7-47db-9644-228dc5328c84"

describe("episode library request parsers", () => {
  it("parses unknown owner-scoped input into immutable application input", async () => {
    const list = await Effect.runPromise(
      parseListCompletedEpisodesInput({ ownerId })
    )
    const get = await Effect.runPromise(
      parseGetCompletedEpisodeInput({ ownerId, episodeId })
    )
    const audio = await Effect.runPromise(
      parseIssueAudioAccessInput({ ownerId, episodeId })
    )

    expect(list).toEqual({ ownerId })
    expect(get).toEqual({ ownerId, episodeId })
    expect(audio).toEqual(get)
    expect(Object.isFrozen(list)).toBe(true)
    expect(Object.isFrozen(get)).toBe(true)
  })

  it.each([
    ["owner omitted", { episodeId }],
    ["owner malformed", { ownerId: "owner", episodeId }],
    ["episode malformed", { ownerId, episodeId: "episode" }],
    ["unexpected field", { ownerId, episodeId, audioUrl: "persist-me" }],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(
      parseGetCompletedEpisodeInput(input)
    )

    expect(exit._tag).toBe("Failure")
  })
})
