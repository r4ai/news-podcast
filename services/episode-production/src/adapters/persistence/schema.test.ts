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
  it("indexes the exact lease priority and business-time order", () => {
    const index = schemaSql().get("episode_jobs_execution_priority") ?? ""

    expect(index).toContain("CASE")
    expect(index).toContain("leased_until")
    expect(index).toContain("retry_at")
    expect(index).toContain("enqueued_at")
    expect(index).toContain("job_id")
    expect(index).not.toContain("json_extract")
  })

  it("uses the lease-priority index without a temporary ORDER BY", () => {
    const handle = open()
    try {
      const plan = handle.client
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT job_id FROM episode_jobs
           WHERE status = 'Queued'
              OR (status = 'Retrying' AND retry_at <= ?)
              OR (status = 'Running' AND leased_until <= ?)
           ORDER BY
             CASE status
               WHEN 'Running' THEN 0
               WHEN 'Retrying' THEN 1
               WHEN 'Queued' THEN 2
               ELSE 3
             END,
             CASE status
               WHEN 'Running' THEN leased_until
               WHEN 'Retrying' THEN retry_at
               WHEN 'Queued' THEN enqueued_at
               ELSE created_at
             END,
             job_id
           LIMIT 1`
        )
        .all("2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z") as {
        readonly detail: string
      }[]
      const details = plan.map(({ detail }) => detail).join("\n")

      expect(details).toContain(
        "SCAN episode_jobs USING INDEX episode_jobs_execution_priority"
      )
      expect(details).not.toContain("USE TEMP B-TREE FOR ORDER BY")
    } finally {
      handle.close()
    }
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

  it("atomically rejects a second active job for the same owner", () => {
    const handle = open()
    try {
      const insert = handle.client.prepare(
        `INSERT INTO episode_jobs(
           job_id, owner_id, idempotency_key, request_fingerprint, trigger,
           status, attempt, created_at, enqueued_at
         ) VALUES (?, 'owner-1', ?, ?, 'manual', 'Queued', 0, ?, ?)`
      )
      insert.run("job-a", "key-a", "fingerprint-a", "t1", "t1")

      expect(() =>
        insert.run("job-b", "key-b", "fingerprint-b", "t2", "t2")
      ).toThrow(/owner_active_job_exists/)
      expect(() =>
        handle.client
          .prepare(
            `INSERT INTO episode_jobs(
               job_id, owner_id, idempotency_key, request_fingerprint, trigger,
               status, attempt, created_at, enqueued_at
             ) VALUES ('job-c', 'owner-2', 'key-c', 'fingerprint-c', 'scheduled',
                       'Queued', 0, 't2', 't2')`
          )
          .run()
      ).not.toThrow()

      handle.client
        .prepare(
          `INSERT INTO episode_jobs(
             job_id, owner_id, idempotency_key, request_fingerprint, trigger,
             status, attempt, created_at, failed_at, failure_code, failure_retryable
           ) VALUES ('job-terminal', 'owner-1', 'key-terminal', 'fingerprint-terminal',
                     'scheduled', 'Failed', 1, 't0', 't1',
                     'no_generation_candidates', 0)`
        )
        .run()
      expect(() =>
        handle.client
          .prepare(
            `UPDATE episode_jobs
             SET status = 'Queued', attempt = 0, enqueued_at = 't3',
                 failed_at = NULL, failure_code = NULL, failure_retryable = NULL
             WHERE job_id = 'job-terminal'`
          )
          .run()
      ).toThrow(/owner_active_job_exists/)
    } finally {
      handle.close()
    }
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
