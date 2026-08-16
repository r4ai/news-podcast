import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  captureReadingDictionarySnapshot,
  createReadingDictionaryEntry,
  deleteReadingDictionaryEntry,
  listReadingDictionaryEntries,
  prepareReadingDictionary,
  updateReadingDictionaryEntry,
  type ReadingDictionaryRepository,
} from "./reading-dictionary.js"
import { OwnerIdSchema, UtcTimestampSchema } from "../domain/episode-job.js"
import {
  ReadingDictionaryIdSchema,
  ReadingDictionaryEntrySchema,
  ReadingDictionarySnapshotSchema,
} from "../domain/reading-dictionary.js"
import type { ReadingTermExtractor } from "./ports/reading-term-extractor.js"

const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)("owner-a")
const entry = Schema.decodeUnknownSync(ReadingDictionaryEntrySchema)({
  id: "10000000-0000-4000-8000-000000000001",
  ownerId,
  surface: "GPT-5",
  reading: "ジーピーティーファイブ",
  accentType: 6,
  source: "manual",
  episodeJobId: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
})

describe("reading dictionary use cases", () => {
  it("constructs a validated manual entry before persistence", async () => {
    const create = vi.fn<ReadingDictionaryRepository["create"]>((entry) =>
      Effect.succeed({ _tag: "Created" as const, entry })
    )
    const result = await Effect.runPromise(
      createReadingDictionaryEntry(
        {
          create,
          nextId: Effect.succeed(
            Schema.decodeUnknownSync(ReadingDictionaryIdSchema)(
              "10000000-0000-4000-8000-000000000001"
            )
          ),
          now: Effect.succeed(
            Schema.decodeUnknownSync(UtcTimestampSchema)(
              "2026-08-13T00:00:00.000Z"
            )
          ),
        },
        {
          ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-a"),
          surface: "GPT-5",
          reading: "ジーピーティーファイブ",
          accentType: 6,
        }
      )
    )

    expect(result._tag).toBe("Created")
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-a",
        source: "manual",
        episodeJobId: null,
      })
    )
    expect(Object.isFrozen(create.mock.calls[0]![0])).toBe(true)
  })

  it("does not call persistence when input violates the contract", async () => {
    const create = vi.fn<ReadingDictionaryRepository["create"]>()
    const exit = await Effect.runPromiseExit(
      createReadingDictionaryEntry(
        {
          create,
          nextId: Effect.die("must not allocate"),
          now: Effect.die("must not read clock"),
        },
        {
          ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-a"),
          surface: "GPT-5",
          reading: "not-katakana",
          accentType: 0,
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(create).not.toHaveBeenCalled()
  })

  it("defaults a manual accent to zero", async () => {
    const create = vi.fn<ReadingDictionaryRepository["create"]>((entry) =>
      Effect.succeed({ _tag: "Created" as const, entry })
    )
    await Effect.runPromise(
      createReadingDictionaryEntry(
        {
          create,
          nextId: Effect.succeed(entry.id),
          now: Effect.succeed(entry.createdAt),
        },
        { ownerId, surface: "Cloudflare", reading: "クラウドフレア" }
      )
    )

    expect(create.mock.calls[0]![0].accentType).toBe(0)
  })

  it("forwards owner-scoped list, delete, and snapshot operations", async () => {
    const list = vi.fn<ReadingDictionaryRepository["list"]>(() =>
      Effect.succeed([entry])
    )
    const remove = vi.fn<ReadingDictionaryRepository["remove"]>(() =>
      Effect.succeed({ _tag: "Deleted" as const })
    )
    const snapshot = Schema.decodeUnknownSync(ReadingDictionarySnapshotSchema)({
      ownerId,
      fingerprint: "a".repeat(64),
      entries: [],
    })
    const captureSnapshot = vi.fn<
      ReadingDictionaryRepository["captureSnapshot"]
    >(() => Effect.succeed(snapshot))

    expect(
      await Effect.runPromise(listReadingDictionaryEntries({ list }, ownerId))
    ).toEqual([entry])
    expect(
      await Effect.runPromise(
        deleteReadingDictionaryEntry({ remove }, ownerId, entry.id)
      )
    ).toEqual({ _tag: "Deleted" })
    expect(
      await Effect.runPromise(
        captureReadingDictionarySnapshot({ captureSnapshot }, ownerId)
      )
    ).toEqual(snapshot)
    expect(list).toHaveBeenCalledWith(ownerId)
    expect(remove).toHaveBeenCalledWith(ownerId, entry.id)
    expect(captureSnapshot).toHaveBeenCalledWith(ownerId)
  })

  it("validates and timestamps an update before persistence", async () => {
    const update = vi.fn<ReadingDictionaryRepository["update"]>(
      (_ownerId, _entryId, patch) =>
        Effect.succeed({
          _tag: "Updated" as const,
          entry: { ...entry, ...patch },
        })
    )
    const updatedAt = Schema.decodeUnknownSync(UtcTimestampSchema)(
      "2026-08-13T00:01:00.000Z"
    )

    const result = await Effect.runPromise(
      updateReadingDictionaryEntry(
        { update, now: Effect.succeed(updatedAt) },
        {
          ownerId,
          id: entry.id,
          patch: { reading: "ジーピーティーフォー" },
        }
      )
    )

    expect(result._tag).toBe("Updated")
    expect(update).toHaveBeenCalledWith(ownerId, entry.id, {
      reading: "ジーピーティーフォー",
      updatedAt,
    })

    const invalid = await Effect.runPromiseExit(
      updateReadingDictionaryEntry(
        { update, now: Effect.die("must not read clock") },
        { ownerId, id: entry.id, patch: {} }
      )
    )
    expect(invalid._tag).toBe("Failure")
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("registers unique extracted terms for the owner before capturing a snapshot", async () => {
    const automatic = Schema.decodeUnknownSync(ReadingDictionaryEntrySchema)({
      id: "10000000-0000-4000-8000-000000000002",
      ownerId,
      surface: "OpenAI",
      reading: "オープンエーアイ",
      accentType: 0,
      source: "ai_auto",
      episodeJobId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    })
    const extractor: ReadingTermExtractor = {
      extract: () =>
        Effect.succeed([
          {
            surface: automatic.surface,
            reading: automatic.reading,
            accentType: automatic.accentType,
          },
          {
            surface: entry.surface,
            reading: entry.reading,
            accentType: entry.accentType,
          },
        ]),
    }
    const create = vi.fn<ReadingDictionaryRepository["create"]>((value) =>
      Effect.succeed({ _tag: "Created", entry: value })
    )
    const snapshot = Schema.decodeUnknownSync(ReadingDictionarySnapshotSchema)({
      ownerId,
      fingerprint: "b".repeat(64),
      entries: [
        {
          surface: automatic.surface,
          reading: automatic.reading,
          accentType: 0,
        },
      ],
    })

    const result = await Effect.runPromise(
      prepareReadingDictionary(
        {
          extractor,
          list: () => Effect.succeed([entry]),
          create,
          captureSnapshot: () => Effect.succeed(snapshot),
          nextId: () => automatic.id,
          now: () => automatic.createdAt,
        },
        {
          ownerId,
          episodeJobId: automatic.episodeJobId!,
          script: "OpenAIとGPT-5のニュースです",
        }
      )
    )

    expect(result).toEqual({ snapshot, addedCount: 1, extractionFailed: false })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, surface: "OpenAI", source: "ai_auto" })
    )
  })

  it("keeps generation available when automatic extraction fails", async () => {
    const snapshot = Schema.decodeUnknownSync(ReadingDictionarySnapshotSchema)({
      ownerId,
      fingerprint: "c".repeat(64),
      entries: [],
    })
    const result = await Effect.runPromise(
      prepareReadingDictionary(
        {
          extractor: { extract: () => Effect.fail({ _tag: "Timeout" }) },
          list: () => Effect.succeed([]),
          create: () => Effect.die("must not create"),
          captureSnapshot: () => Effect.succeed(snapshot),
          nextId: () => entry.id,
          now: () => entry.createdAt,
        },
        {
          ownerId,
          episodeJobId: "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
          script: "台本",
        }
      )
    )

    expect(result).toEqual({ snapshot, addedCount: 0, extractionFailed: true })
  })
})
