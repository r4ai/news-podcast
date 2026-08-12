import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseCompletedEpisode } from "./parse-stored-episode.js"

const storedEpisode = {
  id: "8a76daf6-d3d7-47db-9644-228dc5328c84",
  ownerId: "339cdfd7-7823-4ac6-82ce-3d56cab7acfa",
  title: "朝のニュース",
  script: "今日のニュースです。",
  audioObjectKey: "owners/339cdf/episodes/8a76/audio.wav",
  audioByteLength: 24_000,
  audioContentType: "audio/wav",
  createdAt: "2026-08-12T00:00:00.000Z",
  sources: [
    {
      sourceKind: "rss",
      url: "https://example.com/news/1",
      title: "一次資料",
      publishedAt: "2026-08-11T23:00:00.000Z",
      snapshotId: "0e6f91b5-5df1-4059-8c24-f4bd2bc36bc2",
    },
    {
      sourceKind: "web",
      url: "https://example.org/reference",
      title: "補足資料",
    },
  ],
}

describe("stored episode parser", () => {
  it("maps persistence discriminants to the immutable domain union", async () => {
    const episode = await Effect.runPromise(
      parseCompletedEpisode(storedEpisode)
    )

    expect(episode.sources.map((source) => source._tag)).toEqual([
      "RssSource",
      "WebSource",
    ])
    expect(Object.isFrozen(episode)).toBe(true)
    expect(Object.isFrozen(episode.audio)).toBe(true)
    expect(Object.isFrozen(episode.sources[0])).toBe(true)
  })

  it.each([
    ["unknown property", { ...storedEpisode, audioUrl: "https://signed.test" }],
    ["empty sources", { ...storedEpisode, sources: [] }],
    ["invalid owner", { ...storedEpisode, ownerId: "owner-1" }],
    ["empty title", { ...storedEpisode, title: "" }],
    [
      "invalid URL",
      {
        ...storedEpisode,
        sources: [{ ...storedEpisode.sources[0], url: "file:///secret" }],
      },
    ],
    [
      "RSS without snapshot",
      {
        ...storedEpisode,
        sources: [{ ...storedEpisode.sources[0], snapshotId: undefined }],
      },
    ],
    [
      "Web source with RSS-only state",
      {
        ...storedEpisode,
        sources: [
          {
            ...storedEpisode.sources[1],
            publishedAt: "2026-08-11T23:00:00.000Z",
          },
        ],
      },
    ],
    ["invalid timestamp", { ...storedEpisode, createdAt: "today" }],
    ["zero byte audio", { ...storedEpisode, audioByteLength: 0 }],
  ])("rejects %s at the unknown boundary", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseCompletedEpisode(input))

    expect(exit._tag).toBe("Failure")
  })
})
