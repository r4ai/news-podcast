import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { openEpisodeLibraryDatabaseUnsafe } from "../../infrastructure/unsafe/drizzle/open.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const migratedSchema = (): ReadonlyMap<string, string> => {
  const directory = mkdtempSync(join(tmpdir(), "episode-library-schema-"))
  directories.push(directory)
  const handle = openEpisodeLibraryDatabaseUnsafe(
    join(directory, "library.sqlite")
  )
  try {
    const rows = handle.client
      .prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all()
    return new Map(rows.map((row) => [String(row.name), String(row.sql)]))
  } finally {
    handle.close()
  }
}

/**
 * drizzle-kitはSTRICTを生成できず、マイグレーションSQLへ手で追記している。
 * 再生成で静かに失われると型の緩みに気づけないため、ここで固定する。
 */
describe("episode-library migrated schema", () => {
  it.each(["episode_completion_inbox", "episodes", "episode_sources"])(
    "declares %s as STRICT",
    (table) => {
      expect(migratedSchema().get(table)).toContain("STRICT")
    }
  )

  it("keeps the audio invariants that the domain cannot enforce on write", () => {
    const episodes = migratedSchema().get("episodes") ?? ""

    expect(episodes).toContain('CHECK("audio_byte_length" > 0)')
    expect(episodes).toContain(
      `CHECK("audio_content_type" IN ('audio/wav', 'audio/mpeg'))`
    )
  })

  it("keeps source provenance constrained by kind", () => {
    const sources = migratedSchema().get("episode_sources") ?? ""

    expect(sources).toContain('CHECK("position" >= 0)')
    expect(sources).toContain(`CHECK("source_kind" IN ('rss', 'web'))`)
    expect(sources).toContain("episode_sources_provenance_check")
  })

  it("cascades source deletion so orphan rows cannot accumulate", () => {
    expect(migratedSchema().get("episode_sources")).toContain(
      "ON DELETE CASCADE"
    )
  })

  it("indexes the keyset pagination order", () => {
    expect(migratedSchema().get("episodes_owner_created_idx")).toContain(
      `"created_at" DESC`
    )
  })
})
