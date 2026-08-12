import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  EpisodeCompletionNoticeSchema,
  type EpisodeCompletionNotice,
} from "../domain/episode-completion.js"
import {
  CompletedEpisodeSchema,
  type CompletedEpisode,
} from "../domain/episode.js"
import { consumeEpisodeCompleted } from "./consume-episode-completed.js"
import type { EpisodeCompletionPorts } from "./completion-ports.js"

const notice: EpisodeCompletionNotice = Effect.runSync(
  parse(EpisodeCompletionNoticeSchema)({
    messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
    episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    ownerId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
    title: "Daily news",
    script: "Full script",
    audio: {
      objectKey: "episodes/user/episode.wav",
      byteLength: 42,
      contentType: "audio/wav",
    },
    sources: [
      {
        _tag: "RssSource",
        url: "https://example.com/news/1",
        title: "News 1",
        snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4",
      },
    ],
    completedAt: "2026-08-12T00:00:00.000Z",
    occurredAt: "2026-08-12T00:00:00.000Z",
  })
) as EpisodeCompletionNotice

const episode: CompletedEpisode = Effect.runSync(
  parse(CompletedEpisodeSchema)({
    _tag: "CompletedEpisode",
    id: notice.episodeId,
    ownerId: notice.ownerId,
    title: notice.title,
    script: notice.script,
    audio: {
      objectKey: notice.audio.objectKey,
      byteLength: notice.audio.byteLength,
      contentType: notice.audio.contentType,
    },
    sources: [
      {
        _tag: "RssSource",
        url: notice.sources[0].url,
        title: notice.sources[0].title,
        snapshotId: notice.sources[0].snapshotId,
      },
    ],
    createdAt: notice.completedAt,
  })
) as CompletedEpisode

const ports = (): EpisodeCompletionPorts => ({
  materialize: vi.fn(() => Effect.succeed(episode)),
  saveOnce: vi.fn(() => Effect.succeed("Stored" as const)),
})

describe("consume episode completed", () => {
  it("materializes and atomically saves a matching completion", async () => {
    const dependencies = ports()

    const result = await Effect.runPromise(
      consumeEpisodeCompleted(dependencies)(notice)
    )

    expect(result).toBe("Stored")
    expect(dependencies.materialize).toHaveBeenCalledWith(notice)
    expect(dependencies.saveOnce).toHaveBeenCalledWith(
      notice.messageId,
      episode,
      notice.occurredAt
    )
  })

  it("rejects mismatched materialized data before persistence", async () => {
    const dependencies = ports()
    vi.mocked(dependencies.materialize).mockReturnValue(
      Effect.succeed({ ...episode, title: "Wrong title" } as never)
    )

    const exit = await Effect.runPromiseExit(
      consumeEpisodeCompleted(dependencies)(notice)
    )

    expect(exit._tag).toBe("Failure")
    expect(dependencies.saveOnce).not.toHaveBeenCalled()
  })
})
