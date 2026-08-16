import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import {
  IdempotencyKeySchema,
  JobIdSchema,
  LeaseTokenSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  leaseQueuedJob,
  newQueuedJob,
} from "../../../domain/episode-job.js"
import { openProductionDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeJobHandle } from "./handle.js"
import { toStatusEventDocument } from "./state-columns.js"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const at = Schema.decodeUnknownSync(UtcTimestampSchema)
const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)("owner-1")

const openHandle = () => {
  const directory = mkdtempSync(join(tmpdir(), "job-status-events-"))
  directories.push(directory)
  const database = openProductionDatabaseUnsafe(
    join(directory, "production.sqlite")
  )
  return { handle: makeJobHandle(database.database), database }
}

const queued = newQueuedJob({
  jobId,
  ownerId,
  idempotencyKey: Schema.decodeUnknownSync(IdempotencyKeySchema)("key-1"),
  trigger: "manual",
  enqueuedAt: at("2026-08-13T00:00:00.000Z"),
})

const running = leaseQueuedJob(queued, {
  token: Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1"),
  leasedUntil: at("2026-08-13T00:05:00.000Z"),
  startedAt: at("2026-08-13T00:01:00.000Z"),
})

const eventTypes = (
  handle: ReturnType<typeof makeJobHandle>
): readonly string[] =>
  handle
    .listOwnedAgUiEvents({
      ownerId,
      jobId,
      afterSequence: 0,
      limit: 50,
    })
    .map(({ payload }) => (JSON.parse(payload) as { type: string }).type)

const save = (handle: ReturnType<typeof makeJobHandle>) =>
  handle.saveIdempotently({
    ownerId,
    idempotencyKey: "key-1",
    requestFingerprint: "fingerprint",
    jobId,
    document: toStatusEventDocument(queued),
  })

/**
 * 以前は episode_jobs のトリガが状態イベントを materialize していた。
 * 書き込む側が明示的に積むようになっても、記録される列と条件が同じであることを固定する。
 */
describe("durable AG-UI events", () => {
  it("records the initial state when the job is created", () => {
    const { handle, database } = openHandle()
    try {
      save(handle)

      expect(eventTypes(handle)).toEqual(["STATE_SNAPSHOT"])
    } finally {
      database.close()
    }
  })

  it("records a transition when the status actually changes", () => {
    const { handle, database } = openHandle()
    try {
      save(handle)
      handle.replaceOwnedActive({
        ownerId,
        jobId,
        replace: () => toStatusEventDocument(running),
      })

      expect(eventTypes(handle)).toEqual([
        "STATE_SNAPSHOT",
        "RUN_STARTED",
        "STATE_SNAPSHOT",
      ])
    } finally {
      database.close()
    }
  })

  it("records nothing when a write leaves the status unchanged", () => {
    const { handle, database } = openHandle()
    try {
      save(handle)
      // リースの更新のように、状態が変わらない書き込みは記録しない。
      handle.replaceOwnedActive({
        ownerId,
        jobId,
        replace: () => toStatusEventDocument(queued),
      })

      expect(eventTypes(handle)).toEqual(["STATE_SNAPSHOT"])
    } finally {
      database.close()
    }
  })

  it("keeps the owner on each event so the stream stays scoped", () => {
    const { handle, database } = openHandle()
    try {
      save(handle)

      expect(
        handle.listOwnedAgUiEvents({
          ownerId: "another-owner",
          jobId,
          afterSequence: 0,
          limit: 50,
        })
      ).toEqual([])
    } finally {
      database.close()
    }
  })

  it("streams chunk progress as a durable state snapshot", () => {
    const { handle, database } = openHandle()
    try {
      save(handle)
      handle.replaceOwnedActive({
        ownerId,
        jobId,
        replace: () => toStatusEventDocument(running),
      })
      handle.markStep({
        jobId,
        leaseToken: "lease-1",
        step: "synthesizing_audio",
        phase: "started",
        occurredAt: "2026-08-13T00:01:10.000Z",
      })

      expect(
        handle.reportStageProgress({
          jobId,
          leaseToken: "lease-1",
          step: "synthesizing_audio",
          completed: 1,
          total: 2,
          occurredAt: "2026-08-13T00:01:20.000Z",
        })
      ).toBe(true)

      const event = handle
        .listOwnedAgUiEvents({
          ownerId,
          jobId,
          afterSequence: 0,
          limit: 50,
        })
        .at(-1)
      expect(JSON.parse(event!.payload)).toMatchObject({
        type: "STATE_SNAPSHOT",
        snapshot: {
          currentStage: "synthesizing_audio",
          stageProgress: { completed: 1, total: 2 },
        },
      })
    } finally {
      database.close()
    }
  })
})
