import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it } from "vitest"

import { LeaseLostError, LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("episode job control", () => {
  it("cancels active work in the owner scope", async () => {
    const store = createStore()
    const job = await createJob(store, "owner-1", "cancel")
    const leased = store.leaseNext()
    expect(leased?.id).toBe(job.jobId)

    expect(store.cancelJob("owner-2", job.jobId)).toBe("not_found")
    expect(store.cancelJob("owner-1", job.jobId)).toBe("canceled")
    expect(store.getJob("owner-1", job.jobId)).toMatchObject({
      status: "canceled",
    })
    expect(store.cancelJob("owner-1", job.jobId)).toBe("terminal")
    store.close()
  })

  it("retries a failed job under a new ID with the original feed snapshot", async () => {
    const store = createStore()
    const feedId = "00000000-0000-4000-8000-000000000001"
    const original = await createJob(store, "owner-1", "retry", [feedId])
    const leased = store.leaseNext()
    store.failJob(original.jobId, leased!.leaseToken, {
      code: "provider-timeout",
      message: "temporary provider failure",
      retryable: true,
    })

    expect(store.retryFailedJob("owner-2", original.jobId)).toBeUndefined()
    const retried = store.retryFailedJob("owner-1", original.jobId)
    expect(retried).toMatchObject({ status: "queued", attempt: 0 })
    expect(retried?.id).not.toBe(original.jobId)
    expect(store.getJobFeeds(retried!.id).map((feed) => feed.id)).toEqual([
      feedId,
    ])
    expect(store.retryFailedJob("owner-1", retried!.id)).toBeUndefined()
    store.close()
  })

  it("renews a live lease and rejects every stale fenced mutation", async () => {
    const store = createStore()
    const job = await createJob(store, "owner-1", "fencing")
    const started = new Date("2026-08-10T00:00:00.000Z")
    const first = store.leaseNext(started)!

    expect(
      store.renewLease(
        first.id,
        first.leaseToken,
        new Date("2026-08-10T00:00:15.000Z")
      )
    ).toEqual(new Date("2026-08-10T00:01:15.000Z"))
    expect(
      store.leaseNext(new Date("2026-08-10T00:01:01.000Z"))
    ).toBeUndefined()

    const recovered = store.leaseNext(new Date("2026-08-10T00:01:16.000Z"))!
    expect(recovered).toMatchObject({
      id: job.jobId,
      attempt: 2,
      recovered: true,
    })
    expect(() =>
      store.setJobStage(first.id, first.leaseToken, "synthesizing_audio")
    ).toThrow(LeaseLostError)
    expect(() =>
      store.retryJob(first.id, first.leaseToken, new Date(), {
        code: "provider-timeout",
        message: "timeout",
        retryable: true,
      })
    ).toThrow(LeaseLostError)
    expect(() =>
      store.failJob(first.id, first.leaseToken, {
        code: "provider-timeout",
        message: "timeout",
        retryable: true,
      })
    ).toThrow(LeaseLostError)
    expect(() =>
      store.completeJob({
        jobId: first.id,
        ownerId: first.ownerId,
        leaseToken: first.leaseToken,
        episodeId: "stale-episode",
        title: "stale",
        script: "stale",
        audioKey: "stale.wav",
        audioByteLength: 44,
        sources: [],
      })
    ).toThrow(LeaseLostError)
    expect(store.listEpisodes("owner-1")).toEqual([])
    store.close()
  })

  it("terminalizes an expired fourth attempt and cannot create a fifth", async () => {
    const store = createStore()
    const job = await createJob(store, "owner-1", "bounded")
    let now = new Date("2026-08-10T00:00:00.000Z")
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const leased = store.leaseNext(now)!
      expect(leased.attempt).toBe(attempt)
      if (attempt < 4) {
        now = new Date(now.getTime() + 61_000)
      }
    }

    const afterExpiry = new Date(now.getTime() + 61_000)
    expect(store.leaseNext(afterExpiry)).toBeUndefined()
    expect(store.getJob("owner-1", job.jobId)).toMatchObject({
      status: "failed",
      attempt: 4,
      failure: { code: "attempt-limit-exceeded" },
    })
    expect(() =>
      store.database
        .prepare("UPDATE episode_jobs SET attempt = 5 WHERE id = ?")
        .run(job.jobId)
    ).toThrow("episode-job-attempt-out-of-range")
    store.close()
  })

  it("reports low-cardinality queue, stage, lease, and cleanup health", async () => {
    const store = createStore()
    await createJob(store, "owner-1", "health-queued")
    await createJob(store, "owner-1", "health-running")
    const now = new Date("2026-08-10T00:00:00.000Z")
    const running = store.leaseNext(now)!
    store.setJobStage(running.id, running.leaseToken, "synthesizing_audio", now)

    expect(
      store.getJobHealthSnapshot(new Date("2026-08-10T00:00:30.000Z"))
    ).toMatchObject({
      jobs: { queued: 1, running: 1, retrying: 0 },
      oldestQueueAgeMs: expect.any(Number),
      oldestStageAgeMs: { synthesizing_audio: 30_000 },
      expiredLeases: 0,
      cleanupBacklog: 0,
      stagingBytes: 0,
    })
    expect(
      store.getJobHealthSnapshot(new Date("2026-08-10T00:01:01.000Z"))
        .expiredLeases
    ).toBe(1)
    store.close()
  })

  it("invalidates and audits unbounded jobs from the legacy schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "job-control-legacy-"))
    directories.push(directory)
    const databasePath = join(directory, "app.sqlite")
    const database = new DatabaseSync(databasePath)
    database.exec(
      `CREATE TABLE schema_migrations
       (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
    )
    const migrations = new URL("../../migrations/", import.meta.url)
    for (const name of readdirSync(migrations).sort()) {
      if (name >= "0008_bounded_episode_execution.sql") break
      database.exec(readFileSync(new URL(name, migrations), "utf8"))
      database
        .prepare(
          "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)"
        )
        .run(name, "2026-08-10T00:00:00.000Z")
    }
    database
      .prepare(
        `INSERT INTO episode_jobs
         (id, owner_id, idempotency_route, idempotency_key, request_hash,
          status, receipt_json, available_at, created_at, attempt,
          lease_token, lease_expires_at)
         VALUES (?, ?, ?, ?, ?, 'running', '{}', ?, ?, 23, ?, ?)`
      )
      .run(
        "legacy-job",
        "owner-1",
        "/v1/episode-jobs",
        "legacy",
        "legacy-hash",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
        "legacy-token",
        "2026-08-10T00:01:00.000Z"
      )
    database.close()

    const store = new LocalStore(databasePath)
    expect(store.getJob("owner-1", "legacy-job")).toMatchObject({
      status: "failed",
      attempt: 4,
      failure: { code: "legacy-execution-invalidated", retryable: true },
    })
    expect(
      store.database
        .prepare(
          `SELECT event_type, attempt, payload_json FROM episode_job_events
           WHERE job_id = ?`
        )
        .get("legacy-job")
    ).toMatchObject({
      event_type: "legacy_execution_invalidated",
      attempt: 23,
      payload_json: '{"original_attempt":23}',
    })
    store.close()
  })
})

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "job-control-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

function createJob(
  store: LocalStore,
  ownerId: string,
  key: string,
  feedIds: readonly string[] = []
) {
  return store.create({
    ownerId,
    idempotencyKey: key,
    requestHash: `hash-${key}`,
    trigger: "manual",
    feedIds,
  })
}
