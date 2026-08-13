import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import {
  sqliteReadingDictionaryRepository,
  type SqliteReadingDictionaryRepository,
} from "./sqlite-reading-dictionary.js"
import { OwnerIdSchema, UtcTimestampSchema } from "../domain/episode-job.js"
import {
  ReadingDictionaryEntrySchema,
  ReadingDictionaryIdSchema,
} from "../domain/reading-dictionary.js"

const directories: string[] = []
const owner = (value: string) => Schema.decodeUnknownSync(OwnerIdSchema)(value)
const instant = (value: string) =>
  Schema.decodeUnknownSync(UtcTimestampSchema)(value)
const id = (value: string) =>
  Schema.decodeUnknownSync(ReadingDictionaryIdSchema)(value)

const entry = (input: {
  id: string
  ownerId: string
  surface: string
  reading: string
  accentType?: number
}) =>
  Schema.decodeUnknownSync(ReadingDictionaryEntrySchema)({
    id: input.id,
    ownerId: input.ownerId,
    surface: input.surface,
    reading: input.reading,
    accentType: input.accentType ?? 0,
    source: "manual",
    episodeJobId: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  })

const withRepository = async <A>(
  run: (
    repository: SqliteReadingDictionaryRepository
  ) => Effect.Effect<A, unknown>
) => {
  const directory = await mkdtemp(join(tmpdir(), "reading-dictionary-"))
  directories.push(directory)
  return Effect.runPromise(
    Effect.scoped(
      sqliteReadingDictionaryRepository(join(directory, "state.sqlite")).pipe(
        Effect.flatMap(run)
      )
    )
  )
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("SQLite reading dictionary", () => {
  it("is idempotent for the same owner/surface/value and conflicts otherwise", async () => {
    await withRepository((repository) => {
      const first = entry({
        id: "10000000-0000-4000-8000-000000000001",
        ownerId: "owner-a",
        surface: "GPT-5",
        reading: "ジーピーティーファイブ",
        accentType: 6,
      })
      return Effect.gen(function* () {
        const created = yield* repository.create(first)
        const repeated = yield* repository.create({
          ...first,
          id: id("10000000-0000-4000-8000-000000000002"),
        })
        const conflict = yield* repository.create({
          ...first,
          id: id("10000000-0000-4000-8000-000000000003"),
          reading: "ジーピーティーフォー" as never,
        })

        expect(created).toEqual({ _tag: "Created", entry: first })
        expect(repeated).toEqual({ _tag: "Existing", entry: first })
        expect(conflict).toEqual({
          _tag: "Conflict",
          conflictingEntry: first,
        })
      })
    })
  })

  it("isolates list/update/delete operations by owner and reports transitions", async () => {
    await withRepository((repository) => {
      const first = entry({
        id: "10000000-0000-4000-8000-000000000001",
        ownerId: "owner-a",
        surface: "Cloudflare",
        reading: "クラウドフレア",
      })
      return Effect.gen(function* () {
        yield* repository.create(first)
        expect(yield* repository.list(owner("owner-b"))).toEqual([])
        expect(
          yield* repository.update(owner("owner-b"), first.id, {
            reading: "クラウドフレアー" as never,
            updatedAt: instant("2026-08-13T00:01:00.000Z"),
          })
        ).toEqual({ _tag: "NotFound" })
        expect(yield* repository.remove(owner("owner-b"), first.id)).toEqual({
          _tag: "NotFound",
        })

        const updated = yield* repository.update(owner("owner-a"), first.id, {
          reading: "クラウドフレアー" as never,
          updatedAt: instant("2026-08-13T00:01:00.000Z"),
        })
        expect(updated).toEqual({
          _tag: "Updated",
          entry: {
            ...first,
            reading: "クラウドフレアー",
            updatedAt: instant("2026-08-13T00:01:00.000Z"),
          },
        })
        expect(yield* repository.remove(owner("owner-a"), first.id)).toEqual({
          _tag: "Deleted",
        })
        expect(yield* repository.remove(owner("owner-a"), first.id)).toEqual({
          _tag: "NotFound",
        })
      })
    })
  })

  it("reports an explicit update conflict when another entry owns the surface", async () => {
    await withRepository((repository) =>
      Effect.gen(function* () {
        const one = entry({
          id: "10000000-0000-4000-8000-000000000001",
          ownerId: "owner-a",
          surface: "GPT-5",
          reading: "ジーピーティーファイブ",
        })
        const two = entry({
          id: "10000000-0000-4000-8000-000000000002",
          ownerId: "owner-a",
          surface: "Cloudflare",
          reading: "クラウドフレア",
        })
        yield* repository.create(one)
        yield* repository.create(two)

        expect(
          yield* repository.update(owner("owner-a"), two.id, {
            surface: one.surface,
            updatedAt: instant("2026-08-13T00:01:00.000Z"),
          })
        ).toEqual({ _tag: "Conflict", conflictingEntry: one })
      })
    )
  })

  it("captures a deeply immutable deterministic snapshot that changes only with pronunciation state", async () => {
    await withRepository((repository) =>
      Effect.gen(function* () {
        const laterAlphabetically = entry({
          id: randomUUID(),
          ownerId: "owner-a",
          surface: "GPT-5",
          reading: "ジーピーティーファイブ",
          accentType: 6,
        })
        const earlierAlphabetically = entry({
          id: randomUUID(),
          ownerId: "owner-a",
          surface: "Cloudflare",
          reading: "クラウドフレア",
          accentType: 5,
        })
        yield* repository.create(laterAlphabetically)
        yield* repository.create(earlierAlphabetically)

        const first = yield* repository.captureSnapshot(owner("owner-a"))
        const second = yield* repository.captureSnapshot(owner("owner-a"))
        expect(first).toEqual(second)
        expect(first.entries.map(({ surface }) => surface)).toEqual([
          "Cloudflare",
          "GPT-5",
        ])
        expect(first.fingerprint).toMatch(/^[a-f\d]{64}$/)
        expect(Object.isFrozen(first)).toBe(true)
        expect(Object.isFrozen(first.entries)).toBe(true)
        expect(Object.isFrozen(first.entries[0])).toBe(true)

        yield* repository.update(owner("owner-a"), laterAlphabetically.id, {
          reading: "ジーピーティーフォー" as never,
          updatedAt: instant("2026-08-13T00:01:00.000Z"),
        })
        const changed = yield* repository.captureSnapshot(owner("owner-a"))
        expect(changed.fingerprint).not.toBe(first.fingerprint)
        expect(first.entries[1]?.reading).toBe("ジーピーティーファイブ")
      })
    )
  })
})
