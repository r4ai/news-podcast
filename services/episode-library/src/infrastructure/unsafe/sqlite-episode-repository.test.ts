import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { parse } from "@news-podcast/kernel"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { parseCompletedEpisode } from "../../adapters/parse-stored-episode.js"
import { InboxMessageIdSchema } from "../../domain/episode-completion.js"
import type { CompletedEpisode } from "../../domain/episode.js"
import { makeSqliteEpisodeRepository } from "./sqlite-episode-repository.js"

const ownerId = "d25da30b-4cd1-4875-94c7-6d48f32b5b1c"
const otherOwnerId = "153ce5b9-6481-44ee-a82a-d5b065e03bda"
const receivedAt = "2026-08-12T00:00:00.000Z" as never
const temporaryDirectories: string[] = []

const messageId = (value: string) =>
  Effect.runSync(parse(InboxMessageIdSchema)(value))

const episode = (
  id = "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  overrides: Readonly<Record<string, unknown>> = {}
): CompletedEpisode =>
  Effect.runSync(
    parseCompletedEpisode({
      id,
      ownerId,
      title: "Daily news",
      script: "Full immutable script",
      audioObjectKey: `episodes/${ownerId}/${id}.wav`,
      audioByteLength: 42,
      audioContentType: "audio/wav",
      createdAt: receivedAt,
      sources: [
        {
          sourceKind: "web",
          url: "https://example.com/news/1",
          title: "News 1",
        },
      ],
      ...overrides,
    })
  )

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("single-writer SQLite episode repository", () => {
  it("commits inbox dedupe and episode persistence once", async () => {
    const repository = makeSqliteEpisodeRepository(":memory:")
    const completed = episode()
    const id = messageId("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80")

    const [stored, duplicate, loaded] = await Effect.runPromise(
      Effect.gen(function* () {
        const stored = yield* repository.saveOnce(id, completed, receivedAt)
        const duplicate = yield* repository.saveOnce(id, completed, receivedAt)
        const loaded = yield* repository.findByOwner(
          completed.ownerId,
          completed.id
        )
        return [stored, duplicate, loaded] as const
      }).pipe(Effect.ensuring(repository.close))
    )

    expect(stored).toBe("Stored")
    expect(duplicate).toBe("Duplicate")
    expect(loaded).toEqual(completed)
    expect(Object.isFrozen(loaded)).toBe(true)
  })

  it("rejects reuse of a message ID for a different aggregate", async () => {
    const repository = makeSqliteEpisodeRepository(":memory:")
    const original = episode()
    const id = messageId("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80")

    const exit = await Effect.runPromiseExit(
      repository
        .saveOnce(id, original, receivedAt)
        .pipe(
          Effect.andThen(
            repository.saveOnce(
              id,
              episode(original.id, { script: "Changed replay payload" }),
              receivedAt
            )
          ),
          Effect.ensuring(repository.close)
        )
    )

    expect(exit._tag).toBe("Failure")
  })

  it("scopes list and get in SQL by owner", async () => {
    const repository = makeSqliteEpisodeRepository(":memory:")
    const completed = episode()

    const [list, found] = await Effect.runPromise(
      repository
        .saveOnce(
          messageId("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"),
          completed,
          receivedAt
        )
        .pipe(
          Effect.andThen(
            Effect.all([
              repository.listByOwner(otherOwnerId as never),
              repository.findByOwner(otherOwnerId as never, completed.id),
            ])
          ),
          Effect.ensuring(repository.close)
        )
    )

    expect(list).toEqual([])
    expect(found).toBeUndefined()
  })

  it("rolls back the inbox insert when episode persistence fails", async () => {
    const repository = makeSqliteEpisodeRepository(":memory:")
    const first = episode()
    const reusedMessageId = messageId("f8f15e30-6877-4b4d-9568-76bfa3dc3e40")
    const replacement = episode("3c4d046c-b47b-4047-a562-66ac7e74e995")

    const result = await Effect.runPromise(
      repository
        .saveOnce(
          messageId("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"),
          first,
          receivedAt
        )
        .pipe(
          Effect.andThen(
            Effect.ignore(
              repository.saveOnce(
                reusedMessageId,
                episode(first.id, { script: "Conflicting aggregate" }),
                receivedAt
              )
            )
          ),
          Effect.andThen(
            repository.saveOnce(reusedMessageId, replacement, receivedAt)
          ),
          Effect.ensuring(repository.close)
        )
    )

    expect(result).toBe("Stored")
  })

  it("never creates a column for a signed audio URL", async () => {
    const directory = mkdtempSync(join(tmpdir(), "episode-library-"))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, "library.sqlite")
    const repository = makeSqliteEpisodeRepository(databasePath)
    await Effect.runPromise(repository.close)

    const database = new DatabaseSync(databasePath, { readOnly: true })
    const sql = database
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name IN ('episodes', 'episode_sources')`
      )
      .all()
      .map((row) => String(row.sql))
      .join("\n")
    database.close()

    expect(sql).not.toMatch(/signed_url|audio_url/i)
  })
})
