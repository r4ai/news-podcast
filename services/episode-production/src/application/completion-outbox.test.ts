import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { relayCompletionOutbox, type CompletionOutboxPorts } from "./completion-outbox.js"
import {
  EpisodeIdSchema,
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
} from "../domain/episode-job.js"

const decode = Schema.decodeUnknownSync
const jobId = decode(JobIdSchema)("10e2d4e1-c127-479f-a124-2ea037bd9319")
const completedAt = decode(UtcTimestampSchema)("2026-08-13T00:02:00.000Z")
const pending = {
  jobId,
  completion: {
    episodeId: decode(EpisodeIdSchema)("cd31ca98-fb40-4925-a51c-60940a535c8a"),
    ownerId: decode(OwnerIdSchema)("owner-1"),
    title: "Daily",
    script: "Verified script",
    audio: {
      episodeId: decode(EpisodeIdSchema)("cd31ca98-fb40-4925-a51c-60940a535c8a"),
      objectKey: "episodes/owner/job/episode.wav",
      byteLength: 44,
      contentType: "audio/wav" as const,
    },
    sources: [{
      articleId: "article-1",
      snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4",
      url: "https://example.com/news",
      title: "News",
    }],
    completedAt,
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
} as const

const ports = (): CompletionOutboxPorts => ({
  listPending: vi.fn(() => Effect.succeed([pending])),
  publish: vi.fn(() => Effect.succeed({ duplicate: false })),
  markPublished: vi.fn(() => Effect.void),
  now: () => completedAt,
})

describe("completion outbox relay", () => {
  it("publishes a self-contained v2 event before marking the row", async () => {
    const dependencies = ports()
    const result = await Effect.runPromise(relayCompletionOutbox(dependencies))

    expect(result).toEqual({ published: 1, duplicates: 0 })
    const published = vi.mocked(dependencies.publish).mock.calls[0]![0]
    expect(JSON.parse(published.payload)).toMatchObject({
      messageId: jobId,
      payload: {
        script: "Verified script",
        audio: { byteLength: 44 },
        sources: [{ snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4" }],
      },
    })
    expect(dependencies.markPublished).toHaveBeenCalledWith(jobId, completedAt)
    expect(
      vi.mocked(dependencies.publish).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(dependencies.markPublished).mock.invocationCallOrder[0]!)
  })

  it("does not mark when publication fails", async () => {
    const dependencies = ports()
    vi.mocked(dependencies.publish).mockReturnValue(
      Effect.fail({ _tag: "PipelineFailure", code: "nats_unavailable", retryable: true })
    )

    const exit = await Effect.runPromiseExit(relayCompletionOutbox(dependencies))
    expect(exit._tag).toBe("Failure")
    expect(dependencies.markPublished).not.toHaveBeenCalled()
  })
})
