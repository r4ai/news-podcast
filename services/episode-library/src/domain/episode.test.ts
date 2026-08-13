import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  type CompletedEpisode,
  CompletedEpisodeSchema,
  type EpisodeSource,
} from "./episode.js"

const completedEpisode = {
  _tag: "CompletedEpisode",
  id: "8a76daf6-d3d7-47db-9644-228dc5328c84",
  ownerId: "339cdfd7-7823-4ac6-82ce-3d56cab7acfa",
  title: "朝のニュース",
  script: "今日のニュースです。",
  audio: {
    objectKey: "owners/339cdf/episodes/8a76/audio.wav",
    byteLength: 24_000,
    contentType: "audio/wav",
  },
  createdAt: "2026-08-12T00:00:00.000Z",
  sources: [
    {
      _tag: "RssSource",
      url: "https://example.com/news/1",
      title: "一次資料",
      publishedAt: "2026-08-11T23:00:00.000Z",
      snapshotId: "0e6f91b5-5df1-4059-8c24-f4bd2bc36bc2",
    },
    {
      _tag: "WebSource",
      url: "https://example.org/reference",
      title: "補足資料",
    },
  ],
}

const parseCompletedEpisode = parse(CompletedEpisodeSchema)

describe("completed episode domain", () => {
  it("parses a complete episode into a deeply immutable discriminated model", async () => {
    const episode = await Effect.runPromise(
      parseCompletedEpisode(completedEpisode)
    )

    expect(episode._tag).toBe("CompletedEpisode")
    expect(episode.sources.map((source) => source._tag)).toEqual([
      "RssSource",
      "WebSource",
    ])
    expect(Object.isFrozen(episode)).toBe(true)
    expect(Object.isFrozen(episode.audio)).toBe(true)
    expect(Object.isFrozen(episode.sources)).toBe(true)
    expect(Object.isFrozen(episode.sources[0])).toBe(true)
    expect(episode).not.toHaveProperty("audioUrl")
    expectTypeOf<CompletedEpisode["sources"]>().toMatchTypeOf<
      readonly [EpisodeSource, ...EpisodeSource[]]
    >()
  })

  it.each([
    [
      "unknown property",
      { ...completedEpisode, audioUrl: "https://signed.test" },
    ],
    ["empty sources", { ...completedEpisode, sources: [] }],
    ["invalid owner", { ...completedEpisode, ownerId: "   " }],
    [
      "owner containing whitespace",
      { ...completedEpisode, ownerId: "owner id" },
    ],
    ["empty title", { ...completedEpisode, title: "" }],
    [
      "invalid URL",
      {
        ...completedEpisode,
        sources: [{ ...completedEpisode.sources[0], url: "file:///secret" }],
      },
    ],
    [
      "RSS without snapshot",
      {
        ...completedEpisode,
        sources: [{ ...completedEpisode.sources[0], snapshotId: undefined }],
      },
    ],
    [
      "Web source with RSS-only state",
      {
        ...completedEpisode,
        sources: [
          {
            ...completedEpisode.sources[1],
            publishedAt: "2026-08-11T23:00:00.000Z",
          },
        ],
      },
    ],
    ["invalid timestamp", { ...completedEpisode, createdAt: "today" }],
    [
      "zero byte audio",
      {
        ...completedEpisode,
        audio: { ...completedEpisode.audio, byteLength: 0 },
      },
    ],
  ])("rejects %s at the unknown boundary", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseCompletedEpisode(input))

    expect(exit._tag).toBe("Failure")
  })
})
