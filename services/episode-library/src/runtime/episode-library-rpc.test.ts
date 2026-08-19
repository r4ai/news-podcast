import { parse } from "@news-podcast/kernel"
import {
  parseCreateAudioAccessReply,
  parseGetEpisodeReply,
  parseListEpisodesReply,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type {
  AudioAccessSigner,
  CompletedEpisodeReader,
} from "../application/ports/episode-library.js"
import {
  CompletedEpisodeSchema,
  type CompletedEpisode,
} from "../domain/episode.js"
import { encodeEpisodePageCursor } from "../adapters/episode-page-cursor.js"
import { makeEpisodeLibraryRpcHandler } from "./episode-library-rpc.js"

const ownerId = "better-auth-user_01"
const otherOwnerId = "other-user"
const episodeId = "8a76daf6-d3d7-47db-9644-228dc5328c84"
const articleId = "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
const snapshotId = "06c0200a-e447-4243-b5e7-f31e7464f2e4"

const episode = (ownedBy = ownerId): CompletedEpisode =>
  Effect.runSync(
    parse(CompletedEpisodeSchema)({
      _tag: "CompletedEpisode",
      id: episodeId,
      ownerId: ownedBy,
      title: "Daily news",
      script: "Immutable script",
      audio: {
        objectKey: `episodes/${episodeId}.wav`,
        byteLength: 42,
        contentType: "audio/wav",
      },
      sources: [
        {
          _tag: "RssSource",
          articleId,
          url: "https://example.com/news/1",
          title: "News 1",
          snapshotId,
        },
      ],
      createdAt: "2026-08-12T00:00:00.000Z",
    })
  ) as CompletedEpisode

const request = (
  payload: unknown,
  actor: unknown = { _tag: "User", userId: ownerId }
) => ({
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "gateway",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor,
  payload,
})

const dependencies = {
  newMessageId: () => "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  now: () => "2026-08-12T00:00:01.000Z",
  nowEpochMillis: () => Date.parse("2026-08-12T00:00:00.000Z"),
}

const replyPayload = async (reply: string) => {
  const envelope = await Effect.runPromise(
    parseMessageEnvelope(JSON.parse(reply) as unknown)
  )
  return { envelope, payload: envelope.payload }
}

describe("episode-library RPC handler", () => {
  it("returns one owner-scoped episode without storage metadata", async () => {
    const owned = episode()
    const reader: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(),
      findByOwner: vi.fn(() => Effect.succeed(owned)),
    }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        { issue: vi.fn() },
        dependencies
      )({
        subject: subjects.library.getEpisode,
        payload: JSON.stringify(request({ episodeId })),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(reader.findByOwner).toHaveBeenCalledWith(ownerId, episodeId)
    const { payload } = await replyPayload(replies[0]!)
    const parsed = await Effect.runPromise(parseGetEpisodeReply(payload))
    expect(parsed).toMatchObject({
      _tag: "Found",
      episode: {
        id: episodeId,
        sources: [{ sourceKind: "rss", articleId, snapshotId }],
      },
    })
    expect(JSON.stringify(parsed)).not.toContain("ownerId")
    expect(JSON.stringify(parsed)).not.toContain("objectKey")
  })

  it("derives the owner from a trusted User actor and returns a correlated list envelope", async () => {
    const owned = episode()
    const reader: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(() =>
        Effect.succeed([owned, episode(otherOwnerId)])
      ),
      findByOwner: vi.fn(() => Effect.succeed(owned)),
    }
    const signer: AudioAccessSigner = {
      issue: vi.fn(() => Effect.succeed("https://audio.test/signed" as never)),
    }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        signer,
        dependencies
      )({
        subject: subjects.library.listEpisodes,
        payload: JSON.stringify(request({})),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(reader.listPageByOwner).toHaveBeenCalledWith(ownerId, { limit: 21 })
    const { envelope, payload } = await replyPayload(replies[0]!)
    const parsed = await Effect.runPromise(parseListEpisodesReply(payload))
    expect(envelope).toMatchObject({
      producer: "episode-library",
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      causationId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      actor: { _tag: "Service", service: "episode-library" },
    })
    expect(envelope.traceparent).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[\da-f]{16}-01$/
    )
    expect(envelope.traceparent).not.toBe(request({}).traceparent)
    expect(parsed).toMatchObject({
      _tag: "Listed",
      page: {
        items: [
          {
            id: episodeId,
            sources: [{ sourceKind: "rss", articleId, snapshotId }],
          },
        ],
        page: { hasMore: false },
      },
    })
    expect(JSON.stringify(parsed)).not.toContain("ownerId")
    expect(JSON.stringify(parsed)).not.toContain("objectKey")
  })

  it("does not reveal or sign a foreign episode", async () => {
    const reader: CompletedEpisodeReader = {
      listPageByOwner: () => Effect.succeed([]),
      findByOwner: vi.fn(() => Effect.succeed(episode(otherOwnerId))),
    }
    const signer: AudioAccessSigner = {
      issue: vi.fn(() => Effect.succeed("https://audio.test/leak" as never)),
    }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        signer,
        dependencies
      )({
        subject: subjects.library.createAudioAccess,
        payload: JSON.stringify(request({ episodeId })),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    const { payload } = await replyPayload(replies[0]!)
    expect(
      await Effect.runPromise(parseCreateAudioAccessReply(payload))
    ).toEqual({ _tag: "NotFound" })
    expect(reader.findByOwner).toHaveBeenCalledWith(ownerId, episodeId)
    expect(signer.issue).not.toHaveBeenCalled()
  })

  it("rejects anonymous actors without consulting storage", async () => {
    const reader: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(),
      findByOwner: vi.fn(),
    }
    const signer: AudioAccessSigner = { issue: vi.fn() }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        signer,
        dependencies
      )({
        subject: subjects.library.listEpisodes,
        payload: JSON.stringify(request({}, { _tag: "Anonymous" })),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    const { payload } = await replyPayload(replies[0]!)
    expect(await Effect.runPromise(parseListEpisodesReply(payload))).toEqual({
      _tag: "Rejected",
      code: "UNAUTHENTICATED",
    })
    expect(reader.listPageByOwner).not.toHaveBeenCalled()
  })

  it("maps storage and signing failures to stable protocol rejections", async () => {
    const storageFailure = {
      _tag: "EpisodeLibraryStorageFailure" as const,
      operation: "list" as const,
    }
    const reader: CompletedEpisodeReader = {
      listPageByOwner: () => Effect.fail(storageFailure),
      findByOwner: () => Effect.succeed(episode()),
    }
    const signer: AudioAccessSigner = {
      issue: () => Effect.fail({ _tag: "AudioAccessSigningFailure" }),
    }
    const replies: string[] = []
    const handler = makeEpisodeLibraryRpcHandler(reader, signer, dependencies)

    await Effect.runPromise(
      handler({
        subject: subjects.library.listEpisodes,
        payload: JSON.stringify(request({})),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )
    await Effect.runPromise(
      handler({
        subject: subjects.library.createAudioAccess,
        payload: JSON.stringify(request({ episodeId })),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    const list = await replyPayload(replies[0]!)
    const audio = await replyPayload(replies[1]!)
    expect(
      await Effect.runPromise(parseListEpisodesReply(list.payload))
    ).toEqual({ _tag: "Rejected", code: "STORAGE_FAILURE" })
    expect(
      await Effect.runPromise(parseCreateAudioAccessReply(audio.payload))
    ).toEqual({ _tag: "Rejected", code: "SIGNING_FAILURE" })
  })

  it("decodes a cursor into an owner-scoped keyset query", async () => {
    const position = {
      createdAt: "2026-08-11T00:00:00.000Z" as never,
      episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
    }
    const reader: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(() => Effect.succeed([])),
      findByOwner: vi.fn(() => Effect.succeed(undefined)),
    }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        { issue: vi.fn() },
        dependencies
      )({
        subject: subjects.library.listEpisodes,
        payload: JSON.stringify(
          request({ cursor: encodeEpisodePageCursor(position) })
        ),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(reader.listPageByOwner).toHaveBeenCalledWith(ownerId, {
      after: position,
      limit: 21,
    })
    const { payload } = await replyPayload(replies[0]!)
    expect(await Effect.runPromise(parseListEpisodesReply(payload))).toEqual({
      _tag: "Listed",
      page: { items: [], page: { hasMore: false } },
    })
  })

  it("rejects malformed cursors without consulting storage", async () => {
    const reader: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(),
      findByOwner: vi.fn(),
    }
    const replies: string[] = []

    await Effect.runPromise(
      makeEpisodeLibraryRpcHandler(
        reader,
        { issue: vi.fn() },
        dependencies
      )({
        subject: subjects.library.listEpisodes,
        payload: JSON.stringify(request({ cursor: "not-a-valid-cursor" })),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(reader.listPageByOwner).not.toHaveBeenCalled()
    const { payload } = await replyPayload(replies[0]!)
    expect(await Effect.runPromise(parseListEpisodesReply(payload))).toEqual({
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })
})
