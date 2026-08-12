import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { CompletedEpisodeSchema } from "../domain/episode.js"
import type { CompletedEpisode } from "../domain/episode.js"
import {
  getCompletedEpisode,
  issueAudioAccess,
  listCompletedEpisodes,
} from "./episode-library.js"
import type { AudioAccessSigner, CompletedEpisodeReader } from "./ports.js"

const ownerId = "339cdfd7-7823-4ac6-82ce-3d56cab7acfa" as never
const episodeId = "8a76daf6-d3d7-47db-9644-228dc5328c84" as never

const makeEpisode = (episodeOwnerId = ownerId): CompletedEpisode =>
  Effect.runSync(
    parse(CompletedEpisodeSchema)({
      _tag: "CompletedEpisode",
      id: episodeId,
      ownerId: episodeOwnerId,
      title: "朝のニュース",
      script: "台本",
      audio: {
        objectKey: "private/audio.wav",
        byteLength: 42,
        contentType: "audio/wav",
      },
      createdAt: "2026-08-12T00:00:00.000Z",
      sources: [
        {
          _tag: "WebSource",
          url: "https://example.com/source",
          title: "Source",
        },
      ],
    })
  ) as CompletedEpisode

const reader = (episode = makeEpisode()): CompletedEpisodeReader => ({
  listPageByOwner: vi.fn(() => Effect.succeed([episode])),
  findByOwner: vi.fn(() => Effect.succeed(episode)),
})

describe("episode library use cases", () => {
  it("lists and gets immutable public projections using owner-scoped ports", async () => {
    const repository = reader()

    const listed = await Effect.runPromise(
      listCompletedEpisodes(repository)({ ownerId })
    )
    const found = await Effect.runPromise(
      getCompletedEpisode(repository)({ ownerId, episodeId })
    )

    expect(repository.listPageByOwner).toHaveBeenCalledWith(ownerId, {
      limit: 21,
    })
    expect(repository.findByOwner).toHaveBeenCalledWith(ownerId, episodeId)
    expect(found).toEqual(listed.items[0])
    expect(found).not.toHaveProperty("ownerId")
    expect(found).not.toHaveProperty("audio")
    expect(listed).toMatchObject({ hasMore: false })
    expect(Object.isFrozen(listed)).toBe(true)
    expect(Object.isFrozen(listed.items)).toBe(true)
    expect(Object.isFrozen(found)).toBe(true)
    expect(Object.isFrozen(found.sources)).toBe(true)
  })

  it("returns a typed not-found error without revealing cross-owner existence", async () => {
    const repository: CompletedEpisodeReader = {
      listPageByOwner: () => Effect.succeed([]),
      findByOwner: vi.fn(() => Effect.succeed(undefined)),
    }

    const exit = await Effect.runPromiseExit(
      getCompletedEpisode(repository)({ ownerId, episodeId })
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("EpisodeNotFound")
      expect(String(exit.cause)).not.toContain(ownerId)
    }
  })

  it("issues a five-minute access URL from the owned audio reference without persisting it", async () => {
    const repository = reader()
    const signer: AudioAccessSigner = {
      issue: vi.fn(() =>
        Effect.succeed("https://audio.test/signed?token=opaque" as never)
      ),
    }

    const access = await Effect.runPromise(
      issueAudioAccess(
        repository,
        signer,
        () => 1_786_492_800_000
      )({
        ownerId,
        episodeId,
      })
    )

    expect(repository.findByOwner).toHaveBeenCalledWith(ownerId, episodeId)
    expect(signer.issue).toHaveBeenCalledWith({
      objectKey: "private/audio.wav",
      contentType: "audio/wav",
      expiresAtEpochMillis: 1_786_493_100_000,
    })
    expect(access).toEqual({
      url: "https://audio.test/signed?token=opaque",
      expiresAt: "2026-08-12T00:05:00.000Z",
    })
    expect(Object.isFrozen(access)).toBe(true)
    expect(makeEpisode()).not.toHaveProperty("audioUrl")
  })

  it("never exposes or signs an episode returned for another owner", async () => {
    const otherOwnerId = "f567f551-a7ba-40da-8c49-05319a27fce0" as never
    const foreignEpisode = makeEpisode(otherOwnerId)
    const repository = reader(foreignEpisode)
    const signer: AudioAccessSigner = {
      issue: vi.fn(() =>
        Effect.succeed("https://audio.test/should-not-exist" as never)
      ),
    }

    const listed = await Effect.runPromise(
      listCompletedEpisodes(repository)({ ownerId })
    )
    const found = await Effect.runPromiseExit(
      getCompletedEpisode(repository)({ ownerId, episodeId })
    )
    const audio = await Effect.runPromiseExit(
      issueAudioAccess(
        repository,
        signer,
        () => 1_786_492_800_000
      )({
        ownerId,
        episodeId,
      })
    )

    expect(listed).toEqual({ items: [], hasMore: false })
    expect(found._tag).toBe("Failure")
    expect(audio._tag).toBe("Failure")
    expect(signer.issue).not.toHaveBeenCalled()
  })

  it("requests one look-ahead row and returns a stable keyset cursor", async () => {
    const episodes = Array.from({ length: 21 }, () => makeEpisode()).map(
      (item, index) => ({
        ...item,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as never,
        createdAt:
          `2026-08-${String(31 - index).padStart(2, "0")}T00:00:00.000Z` as never,
      })
    ) as CompletedEpisode[]
    const repository: CompletedEpisodeReader = {
      listPageByOwner: vi.fn(() => Effect.succeed(episodes)),
      findByOwner: vi.fn(() => Effect.succeed(undefined)),
    }
    const after = {
      createdAt: "2026-07-31T00:00:00.000Z" as never,
      episodeId: "00000000-0000-4000-8000-000000000099" as never,
    }

    const page = await Effect.runPromise(
      listCompletedEpisodes(repository)({ ownerId, after })
    )

    expect(repository.listPageByOwner).toHaveBeenCalledWith(ownerId, {
      after,
      limit: 21,
    })
    expect(page.items).toHaveLength(20)
    expect(page.hasMore).toBe(true)
    expect(page.next).toEqual({
      createdAt: episodes[19]!.createdAt,
      episodeId: episodes[19]!.id,
    })
  })
})
