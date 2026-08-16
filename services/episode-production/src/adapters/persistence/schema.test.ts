import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { openProductionDatabaseUnsafe } from "../../infrastructure/unsafe/drizzle/open.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const open = () => {
  const directory = mkdtempSync(join(tmpdir(), "production-schema-"))
  directories.push(directory)
  return openProductionDatabaseUnsafe(join(directory, "production.sqlite"))
}

const schemaSql = (): ReadonlyMap<string, string> => {
  const handle = open()
  try {
    const rows = handle.client
      .prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all() as unknown as readonly {
      readonly name: string
      readonly sql: string
    }[]
    return new Map(rows.map((row) => [row.name, row.sql]))
  } finally {
    handle.close()
  }
}

const TABLES = [
  "episode_jobs",
  "episode_job_articles",
  "episode_generation_plans",
  "episode_job_agui_events",
  "episode_execution_checkpoints",
  "episode_dictionary_snapshots",
  "episode_completion_outbox",
  "reading_dictionary",
]

describe("episode-production migrated schema", () => {
  it.each(TABLES)("declares %s as STRICT", (table) => {
    expect(schemaSql().get(table)).toContain("STRICT")
  })

  /**
   * 正規化前は json_extract の式インデックスでしか状態を引けなかった。
   * 実カラム化されたことを、索引の形で固定する。
   */
  it("indexes the job status as a real column, not an expression", () => {
    const index = schemaSql().get("episode_jobs_execution_state") ?? ""

    expect(index).toContain("status")
    expect(index).not.toContain("json_extract")
  })

  it("keeps no trigger on episode_jobs, since events are appended by the writer", () => {
    const triggers = [...schemaSql().keys()].filter((name) =>
      name.startsWith("episode_job_status_events_insert")
    )

    expect(triggers).toEqual([])
  })

  it("removes the legacy Agent audit and memory tables", () => {
    const schema = schemaSql()
    for (const table of [
      "production_agent_instances",
      "production_agent_runs",
      "production_agent_events",
      "production_agent_memories",
      "production_agent_memory_versions",
    ]) {
      expect(schema.has(table)).toBe(false)
    }
  })

  it("requires a lease on a running job", () => {
    expect(schemaSql().get("episode_jobs")).toContain(
      "episode_jobs_running_lease_check"
    )
  })

  it("requires an episode on a succeeded job", () => {
    expect(schemaSql().get("episode_jobs")).toContain(
      "episode_jobs_succeeded_check"
    )
  })

  it("rejects a running job that has no lease", () => {
    const handle = open()
    try {
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO episode_jobs(
               job_id, owner_id, idempotency_key, request_fingerprint, trigger,
               status, attempt, created_at, started_at
             ) VALUES ('j', 'o', 'k', 'f', 'manual', 'Running', 1, 't', 't')`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
    } finally {
      handle.close()
    }
  })

  it("cascades job articles so a deleted job leaves no selection behind", () => {
    expect(schemaSql().get("episode_job_articles")).toContain(
      "ON DELETE CASCADE"
    )
  })
})
