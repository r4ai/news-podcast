import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  EpisodeCompletionNoticeSchema,
  matchesCompletionNotice,
  type EpisodeCompletionNotice,
} from "./episode-completion.js"
import { CompletedEpisodeSchema } from "./episode.js"

const notice: EpisodeCompletionNotice = Effect.runSync(
  parse(EpisodeCompletionNoticeSchema)({
    messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
    episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    ownerId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
    audioObjectKey: "episodes/user/episode.wav",
    title: "Daily news",
    sources: [{ url: "https://example.com/news/1", title: "News 1" }],
    occurredAt: "2026-08-12T00:00:00.000Z",
  })
) as EpisodeCompletionNotice

const episode = Effect.runSync(
  parse(CompletedEpisodeSchema)({
    _tag: "CompletedEpisode",
    id: notice.episodeId,
    ownerId: notice.ownerId,
    title: notice.title,
    script: "Full script",
    audio: {
      objectKey: notice.audioObjectKey,
      byteLength: 42,
      contentType: "audio/wav",
    },
    sources: [
      {
        _tag: "WebSource",
        url: notice.sources[0].url,
        title: notice.sources[0].title,
      },
    ],
    createdAt: notice.occurredAt,
  })
)

describe("episode completion notice", () => {
  it("accepts only an aggregate matching the integration contract", () => {
    expect(matchesCompletionNotice(episode as never, notice)).toBe(true)
    expect(
      matchesCompletionNotice(
        { ...episode, title: "Unexpected title" } as never,
        notice
      )
    ).toBe(false)
  })
})
