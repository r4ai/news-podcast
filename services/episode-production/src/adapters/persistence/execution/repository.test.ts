import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { openProductionDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { executionRepository } from "./repository.js"
import { jobRepository } from "../job/repository.js"
import {
  ArticleIdSchema,
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
} from "../../../domain/episode-job.js"
import { ReadingDictionarySnapshotSchema } from "../../../domain/reading-dictionary.js"

const timestamp = (value: string) =>
  Schema.decodeUnknownSync(UtcTimestampSchema)(value)
const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)("owner-1")
const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
  "cd31ca98-fb40-4925-a51c-60940a535c8a"
)
const articleId = Schema.decodeUnknownSync(ArticleIdSchema)(
  "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
)
const token = (value: string) =>
  Schema.decodeUnknownSync(LeaseTokenSchema)(value)

const queued = (
  key = "daily",
  id = jobId,
  enqueuedAt = "2026-08-13T00:00:00.000Z",
  owner = ownerId
) =>
  newQueuedJob({
    jobId: id,
    ownerId: owner,
    idempotencyKey: Schema.decodeUnknownSync(IdempotencyKeySchema)(key),
    trigger: "manual",
    enqueuedAt: timestamp(enqueuedAt),
  })

const databasePath = () =>
  join(mkdtempSync(join(tmpdir(), "episode-execution-")), "jobs.sqlite")

describe("SQLite execution repository", () => {
  it("leases queued jobs by enqueue time and uses UUID only as a tie-breaker", async () => {
    const path = databasePath()
    const olderId = Schema.decodeUnknownSync(JobIdSchema)(
      "ffffffff-ffff-4fff-8fff-ffffffffffff"
    )
    const newerId = Schema.decodeUnknownSync(JobIdSchema)(
      "00000000-0000-4000-8000-000000000001"
    )

    const leased = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* commands.saveIdempotently(
            queued("older", olderId, "2026-08-12T00:00:00.000Z")
          )
          yield* commands.saveIdempotently(
            queued(
              "newer",
              newerId,
              "2026-08-12T00:01:00.000Z",
              Schema.decodeUnknownSync(OwnerIdSchema)("owner-2")
            )
          )
          return yield* execution.leaseNext({
            now: timestamp("2026-08-12T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-12T00:06:00.000Z"),
            leaseToken: token("lease-fifo"),
          })
        })
      )
    )

    expect(leased?.job.jobId).toBe(olderId)
    expect(leased?.readyAt).toEqual(timestamp("2026-08-12T00:00:00.000Z"))
  })

  it("does not starve the oldest queued job while newer jobs keep arriving", async () => {
    const path = databasePath()
    const oldestId = Schema.decodeUnknownSync(JobIdSchema)(
      "ffffffff-ffff-4fff-8fff-ffffffffffff"
    )

    const leasedIds = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* commands.saveIdempotently(
            queued("oldest", oldestId, "2026-08-12T00:00:00.000Z")
          )
          const ids = []
          for (let minute = 1; minute <= 4; minute += 1) {
            const id = Schema.decodeUnknownSync(JobIdSchema)(
              `00000000-0000-4000-8000-00000000000${minute}`
            )
            yield* commands.saveIdempotently(
              queued(
                `newer-${minute}`,
                id,
                `2026-08-12T00:0${minute}:00.000Z`,
                Schema.decodeUnknownSync(OwnerIdSchema)(`owner-${minute + 1}`)
              )
            )
            const leased = yield* execution.leaseNext({
              now: timestamp(`2026-08-12T00:0${minute}:00.000Z`),
              leasedUntil: timestamp("2026-08-12T01:00:00.000Z"),
              leaseToken: token(`lease-${minute}`),
            })
            ids.push(leased?.job.jobId)
          }
          return ids
        })
      )
    )

    expect(leasedIds).toEqual([
      oldestId,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ])
  })

  it("prioritizes expired leases, then due retries, then queued work", async () => {
    const path = databasePath()
    const expiredId = Schema.decodeUnknownSync(JobIdSchema)(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    )
    const retryId = Schema.decodeUnknownSync(JobIdSchema)(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    )
    const queuedId = Schema.decodeUnknownSync(JobIdSchema)(
      "ffffffff-ffff-4fff-8fff-ffffffffffff"
    )

    const leases = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)

          yield* commands.saveIdempotently(
            queued("expired", expiredId, "2026-08-12T00:00:00.000Z")
          )
          yield* execution.leaseNext({
            now: timestamp("2026-08-12T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-12T00:05:00.000Z"),
            leaseToken: token("lease-expired"),
          })

          yield* commands.saveIdempotently(
            queued(
              "retry",
              retryId,
              "2026-08-12T00:01:00.000Z",
              Schema.decodeUnknownSync(OwnerIdSchema)("owner-2")
            )
          )
          const retryRunning = (yield* execution.leaseNext({
            now: timestamp("2026-08-12T00:02:00.000Z"),
            leasedUntil: timestamp("2026-08-12T00:07:00.000Z"),
            leaseToken: token("lease-retry-setup"),
          }))!.job as RunningJob & { readonly attempt: 1 }
          yield* execution.transition({
            jobId: retryId,
            leaseToken: token("lease-retry-setup"),
            state: retryRunningJob(retryRunning, {
              retryAt: timestamp("2026-08-12T00:04:00.000Z"),
              failure: Schema.decodeUnknownSync(RetryableFailureSchema)({
                code: "script_unavailable",
                retryable: true,
              }),
            }),
          })

          yield* commands.saveIdempotently(
            queued(
              "queued",
              queuedId,
              "2026-08-12T00:03:00.000Z",
              Schema.decodeUnknownSync(OwnerIdSchema)("owner-3")
            )
          )
          const input = (leaseToken: string) => ({
            now: timestamp("2026-08-12T00:05:00.000Z"),
            leasedUntil: timestamp("2026-08-12T00:10:00.000Z"),
            leaseToken: token(leaseToken),
          })
          return [
            yield* execution.leaseNext(input("lease-priority-1")),
            yield* execution.leaseNext(input("lease-priority-2")),
            yield* execution.leaseNext(input("lease-priority-3")),
          ]
        })
      )
    )

    expect(leases.map((lease) => lease?.job.jobId)).toEqual([
      expiredId,
      retryId,
      queuedId,
    ])
    expect(leases.map((lease) => lease?.recovered)).toEqual([
      true,
      false,
      false,
    ])
  })

  it("fences checkpoints and atomically records an idempotent success", async () => {
    const path = databasePath()
    const script = {
      title: "Daily",
      script: "Hello",
      sourceIndexes: [0],
    }
    const sources = [
      {
        sourceIndex: 0,
        articleId,
        snapshotId: "snapshot-1",
        url: "https://example.com/article",
        title: "Article",
      },
    ] as const
    const audio = {
      episodeId,
      objectKey: "episodes/daily.mp3",
      byteLength: 42,
      contentType: "audio/mpeg" as const,
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* commands.saveIdempotently(queued())
          const leased = yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          })
          expect(leased?.recovered).toBe(false)
          const running = leased!.job

          yield* execution.markStep({
            jobId,
            leaseToken: token("lease-1"),
            step: "synthesizing_audio",
            phase: "started",
            occurredAt: timestamp("2026-08-13T00:01:10.000Z"),
          })
          yield* execution.reportStageProgress({
            jobId,
            leaseToken: token("lease-1"),
            step: "synthesizing_audio",
            completed: 1,
            total: 2,
            occurredAt: timestamp("2026-08-13T00:01:20.000Z"),
          })
          yield* execution.reportStageProgress({
            jobId,
            leaseToken: token("lease-1"),
            step: "synthesizing_audio",
            completed: 0,
            total: 2,
            occurredAt: timestamp("2026-08-13T00:01:25.000Z"),
          })
          const jobWithProgress = yield* execution.findById(jobId)
          const staleProgressExit = yield* Effect.exit(
            execution.reportStageProgress({
              jobId,
              leaseToken: token("stale"),
              step: "synthesizing_audio",
              completed: 2,
              total: 2,
              occurredAt: timestamp("2026-08-13T00:01:30.000Z"),
            })
          )

          yield* execution.saveGenerationPlan({
            jobId,
            leaseToken: token("lease-1"),
            plan: {
              jobId,
              ownerId,
              selectionMode: "automatic",
              interestProfile: { include: "", exclude: "" },
              selectedArticleIds: [articleId],
              model: "deterministic-fallback",
              createdAt: timestamp("2026-08-13T00:01:00.000Z"),
            },
          })
          const usedBeforeSuccess =
            yield* execution.listUsedAutomaticArticleIds(ownerId)

          const dictionarySnapshot = Schema.decodeUnknownSync(
            ReadingDictionarySnapshotSchema
          )({ ownerId, fingerprint: "a".repeat(64), entries: [] })
          yield* execution.saveDictionarySnapshot({
            jobId,
            leaseToken: token("lease-1"),
            snapshot: dictionarySnapshot,
          })
          const staleDictionaryExit = yield* Effect.exit(
            execution.saveDictionarySnapshot({
              jobId,
              leaseToken: token("stale"),
              snapshot: {
                ...dictionarySnapshot,
                fingerprint: "b".repeat(64) as never,
              },
            })
          )
          const loadedDictionary =
            yield* execution.loadDictionarySnapshot(jobId)

          yield* execution.saveScriptCheckpoint({
            jobId,
            leaseToken: token("lease-1"),
            script,
            sources,
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
              sources,
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
                url: "https://example.com/article",
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
          const usedAfterSuccess =
            yield* execution.listUsedAutomaticArticleIds(ownerId)
          return {
            staleExit,
            staleProgressExit,
            jobWithProgress,
            staleDictionaryExit,
            loadedDictionary,
            checkpoint,
            applied,
            duplicate,
            outbox,
            pending,
            afterPublish,
            usedBeforeSuccess,
            usedAfterSuccess,
          }
        })
      )
    )

    expect(result.staleExit._tag).toBe("Failure")
    expect(result.staleProgressExit._tag).toBe("Failure")
    expect(result.jobWithProgress).toMatchObject({
      _tag: "Running",
      stage: "synthesizing_audio",
      stageStartedAt: timestamp("2026-08-13T00:01:10.000Z"),
      lastProgressAt: timestamp("2026-08-13T00:01:20.000Z"),
      stageProgress: { completed: 1, total: 2 },
    })
    expect(result.staleDictionaryExit._tag).toBe("Failure")
    expect(result.loadedDictionary?.fingerprint).toBe("a".repeat(64))
    expect(Object.isFrozen(result.loadedDictionary)).toBe(true)
    expect(Object.isFrozen(result.loadedDictionary?.entries)).toBe(true)
    expect(result.checkpoint).toEqual({ script, sources, audio })
    expect(result.applied).toBe("Applied")
    expect(result.duplicate).toBe("Duplicate")
    expect(result.outbox?.episodeId).toBe(episodeId)
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]?.jobId).toBe(jobId)
    expect(result.afterPublish).toEqual([])
    expect(result.usedBeforeSuccess).toEqual([])
    expect(result.usedAfterSuccess).toEqual([articleId])
  })

  it("recovers an expired lease without consuming another attempt", async () => {
    const path = databasePath()
    const recovered = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
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
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
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
      result.persisted?._tag === "Running" && result.persisted.lease.leasedUntil
    ).toEqual(timestamp("2026-08-13T00:07:00.000Z"))
  })

  it("leases only due retries and increments their attempt", async () => {
    const path = databasePath()
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* commands.saveIdempotently(queued())
          const first = (yield* execution.leaseNext({
            now: timestamp("2026-08-13T00:01:00.000Z"),
            leasedUntil: timestamp("2026-08-13T00:06:00.000Z"),
            leaseToken: token("lease-1"),
          }))!.job as RunningJob & { readonly attempt: 1 }
          const failure = Schema.decodeUnknownSync(RetryableFailureSchema)({
            code: "script_unavailable",
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
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    })

    const secondState = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = openProductionDatabaseUnsafe(path).database
          const commands = yield* jobRepository(database)
          const execution = yield* executionRepository(database)
          yield* commands.saveIdempotently(queued("first"))
          yield* commands.saveIdempotently(
            queued(
              "second",
              secondJobId,
              "2026-08-13T00:00:00.000Z",
              Schema.decodeUnknownSync(OwnerIdSchema)("owner-2")
            )
          )
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
