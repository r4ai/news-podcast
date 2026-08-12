import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { sqliteExecutionRepository } from "./sqlite-execution-repository.js"
import { sqliteJobRepository } from "./sqlite-job-repository.js"
import {
  EpisodeIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  LeaseTokenSchema,
  OwnerIdSchema,
  RetryableFailureSchema,
  UtcTimestampSchema,
  completeRunningJob,
  newQueuedJob,
  retryRunningJob,
  type RunningJob,
} from "../domain/episode-job.js"

const timestamp = (value: string) =>
  Schema.decodeUnknownSync(UtcTimestampSchema)(value)
const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)("owner-1")
const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
  "cd31ca98-fb40-4925-a51c-60940a535c8a"
)
const token = (value: string) =>
  Schema.decodeUnknownSync(LeaseTokenSchema)(value)

const queued = (key = "daily", id = jobId) =>
  newQueuedJob({
    jobId: id,
    ownerId,
    idempotencyKey: Schema.decodeUnknownSync(IdempotencyKeySchema)(key),
    trigger: "manual",
    enqueuedAt: timestamp("2026-08-13T00:00:00.000Z"),
  })

const databasePath = () =>
  join(mkdtempSync(join(tmpdir(), "episode-execution-")), "jobs.sqlite")

describe("SQLite execution repository", () => {
  it("fences checkpoints and atomically records an idempotent success", async () => {
    const path = databasePath()
    const script = {
      title: "Daily",
      script: "Hello",
      sourceUrls: ["https://example.com/article"],
    }
    const audio = {
      episodeId,
      objectKey: "episodes/daily.mp3",
      byteLength: 42,
      contentType: "audio/mpeg" as const,
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commands = yield* sqliteJobRepository(path)
          const execution = yield* sqliteExecutionRepository(path)
          yield* commands.saveIdempotently(queued())
          const leased = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          })
          expect(leased?.recovered).toBe(false)
          const running = leased!.job

          yield* execution.saveScriptCheckpoint({
            jobId,
            leaseToken: token("lease-1"),
            script,
          })
          yield* execution.saveAudioCheckpoint({
            jobId,
            leaseToken: token("lease-1"),
            audio,
          })
          const staleExit = yield* Effect.exit(
            execution.saveScriptCheckpoint({
              jobId,
              leaseToken: token("stale"),
              script: { ...script, title: "must-not-win" },
            })
          )
          const checkpoint = yield* execution.loadCheckpoint(jobId)
          const completedAt = timestamp("2026-08-13T00:02:00.000Z")
          const state = completeRunningJob(running, { episodeId, completedAt })
          const completion = {
            episodeId,
            ownerId,
            title: script.title,
            script: script.script,
            audio,
            sources: [
              {
                articleId: "article-1",
                snapshotId: "snapshot-1",
                url: script.sourceUrls[0]!,
                title: "Article",
              },
            ],
            completedAt,
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          }
          const applied = yield* execution.completeWithOutbox({
            jobId,
            leaseToken: token("lease-1"),
            state,
            completion,
          })
          const duplicate = yield* execution.completeWithOutbox({
            jobId,
            leaseToken: token("lease-1"),
            state,
            completion,
          })
          const outbox = yield* execution.findCompletionOutbox(jobId)
          const pending = yield* execution.listPendingCompletionOutbox(10)
          yield* execution.markCompletionPublished(jobId, completedAt)
          const afterPublish = yield* execution.listPendingCompletionOutbox(10)
          return {
            staleExit,
            checkpoint,
            applied,
            duplicate,
            outbox,
            pending,
            afterPublish,
          }
        })
      )
    )

    expect(result.staleExit._tag).toBe("Failure")
    expect(result.checkpoint).toEqual({ script, audio })
    expect(result.applied).toBe("Applied")
    expect(result.duplicate).toBe("Duplicate")
    expect(result.outbox?.episodeId).toBe(episodeId)
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]?.jobId).toBe(jobId)
    expect(result.afterPublish).toEqual([])
  })

  it("recovers an expired lease without consuming another attempt", async () => {
    const path = databasePath()
    const recovered = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commands = yield* sqliteJobRepository(path)
          const execution = yield* sqliteExecutionRepository(path)
          yield* commands.saveIdempotently(queued())
          const first = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:02:00.000Z"),
            leaseToken: token("lease-1"),
          })
          const beforeExpiry = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:59.000Z"),
            leasedUntil: timestamp("2026-08-13T00:07:00.000Z"),
            leaseToken: token("lease-2"),
          })
          const afterExpiry = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:02:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:07:00.000Z"),
            leaseToken: token("lease-2"),
          })
          return { first, beforeExpiry, afterExpiry }
        })
      )
    )

    expect(recovered.first?.job.attempt).toBe(1)
    expect(recovered.beforeExpiry).toBeUndefined()
    expect(recovered.afterExpiry?.recovered).toBe(true)
    expect(recovered.afterExpiry?.job.attempt).toBe(1)
    expect(recovered.afterExpiry?.job.lease.token).toBe("lease-2")
  })

  it("renews only an unexpired matching lease and fences stale workers", async () => {
    const path = databasePath()
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commands = yield* sqliteJobRepository(path)
          const execution = yield* sqliteExecutionRepository(path)
          yield* commands.saveIdempotently(queued())
          yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          })

          const applied = yield* execution.renewLease({
            jobId,
            leaseToken: token("lease-1"),
            now: timestamp("2026-08-13T00:02:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:07:00.000Z"),
          })
          const staleToken = yield* execution.renewLease({
            jobId,
            leaseToken: token("lease-stale"),
            now: timestamp("2026-08-13T00:03:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:08:00.000Z"),
          })
          const beforeExtendedExpiry = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:06:30.000Z"),
            leasedUntil: timestamp("2026-08-13T00:11:30.000Z"),
            leaseToken: token("lease-2"),
          })
          const expired = yield* execution.renewLease({
            jobId,
            leaseToken: token("lease-1"),
            now: timestamp("2026-08-13T00:07:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:12:00.000Z"),
          })
          const persisted = yield* execution.findById(jobId)
          return {
            applied,
            staleToken,
            beforeExtendedExpiry,
            expired,
            persisted,
          }
        })
      )
    )

    expect(result.applied).toBe("Applied")
    expect(result.staleToken).toBe("StaleLease")
    expect(result.beforeExtendedExpiry).toBeUndefined()
    expect(result.expired).toBe("StaleLease")
    expect(
      result.persisted?._tag === "Running" &&
        result.persisted.lease.leasedUntil
    ).toEqual(timestamp("2026-08-13T00:07:00.000Z"))
  })

  it("leases only due retries and increments their attempt", async () => {
    const path = databasePath()
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commands = yield* sqliteJobRepository(path)
          const execution = yield* sqliteExecutionRepository(path)
          yield* commands.saveIdempotently(queued())
          const first = (yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          }))!.job as RunningJob & { readonly attempt: 1 }
          const failure = Schema.decodeUnknownSync(RetryableFailureSchema)({
            code: "provider_busy",
            retryable: true,
          })
          yield* execution.transition({
            jobId,
            leaseToken: token("lease-1"),
            state: retryRunningJob(first, {
              retryAt: timestamp("2026-08-13T00:10:00.000Z"),
              failure,
            }),
          })
          const early = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:09:59.000Z"),
            leasedUntil: timestamp("2026-08-13T00:15:00.000Z"),
            leaseToken: token("lease-2"),
          })
          const due = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:10:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:15:00.000Z"),
            leaseToken: token("lease-2"),
          })
          return { early, due }
        })
      )
    )

    expect(values.early).toBeUndefined()
    expect(values.due?.job.attempt).toBe(2)
    expect(values.due?.recovered).toBe(false)
  })

  it("rolls back the success state when the completion outbox insert fails", async () => {
    const path = databasePath()
    const secondJobId = Schema.decodeUnknownSync(JobIdSchema)(
      "20e2d4e1-c127-479f-a124-2ea037bd9319"
    )
    const completedAt = timestamp("2026-08-13T00:02:00.000Z")
    const completionFor = (running: RunningJob) => ({
      state: completeRunningJob(running, { episodeId, completedAt }),
      completion: {
        episodeId,
        ownerId,
        title: "Daily",
        script: "Hello",
        audio: {
          episodeId,
          objectKey: "episodes/daily.mp3",
          byteLength: 42,
          contentType: "audio/mpeg" as const,
        },
        sources: [
          {
            articleId: "article-1",
            snapshotId: "snapshot-1",
            url: "https://example.com/article",
            title: "Article",
          },
        ],
        completedAt,
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    })

    const secondState = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commands = yield* sqliteJobRepository(path)
          const execution = yield* sqliteExecutionRepository(path)
          yield* commands.saveIdempotently(queued("first"))
          yield* commands.saveIdempotently(queued("second", secondJobId))
          const first = (yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          }))!.job
          const second = (yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-2"),
          }))!.job
          yield* execution.completeWithOutbox({
            jobId: first.jobId,
            leaseToken: token("lease-1"),
            ...completionFor(first),
          })
          const failed = yield* Effect.exit(
            execution.completeWithOutbox({
              jobId: second.jobId,
              leaseToken: token("lease-2"),
              ...completionFor(second),
            })
          )
          const persisted = yield* execution.findById(secondJobId)
          return { failed, persisted }
        })
      )
    )

    expect(secondState.failed._tag).toBe("Failure")
    expect(secondState.persisted?._tag).toBe("Running")
    expect(
      secondState.persisted?._tag === "Running" &&
        secondState.persisted.lease.token
    ).toBe("lease-2")
  })
})
