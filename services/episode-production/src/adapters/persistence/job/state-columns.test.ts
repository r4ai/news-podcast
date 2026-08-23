import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  cancelJob,
  completeRunningJob,
  failRunningJob,
  leaseQueuedJob,
  leaseRetryingJob,
  newQueuedJob,
  recoverRunningJob,
  retryRunningJob,
  UtcTimestampSchema,
  type EpisodeJob,
  type RetryableRunningJob,
  type RunningJob,
} from "../../../domain/episode-job.js"
import {
  fromJobRow,
  requestFingerprintOf,
  statusOccurredAt,
  toArticleRows,
  toJobRow,
} from "./state-columns.js"

const at = Schema.decodeUnknownSync(UtcTimestampSchema)
const ownerId = "owner-a" as never
const jobId = "3f1f5a0d-3f0e-4a3f-8bb1-6f6b0a1a2f01" as never
const episodeId = "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never
const leaseToken = "lease-1" as never
const articleIds = [
  "0f4a2f39-1a9b-4c6c-9d3f-1b1f6a1e0001",
  "0f4a2f39-1a9b-4c6c-9d3f-1b1f6a1e0002",
] as never

const queued = newQueuedJob({
  jobId,
  ownerId,
  idempotencyKey: "key-1" as never,
  trigger: "manual",
  enqueuedAt: at("2026-08-13T00:00:00.000Z"),
})

const queuedWithArticles = newQueuedJob({
  jobId,
  ownerId,
  idempotencyKey: "key-2" as never,
  trigger: "scheduled",
  articleIds,
  enqueuedAt: at("2026-08-13T00:00:00.000Z"),
})

const running = leaseQueuedJob(queued, {
  token: leaseToken,
  leasedUntil: at("2026-08-13T00:05:00.000Z"),
  startedAt: at("2026-08-13T00:01:00.000Z"),
})

const retrying = retryRunningJob(running as RetryableRunningJob, {
  retryAt: at("2026-08-13T00:02:00.000Z"),
  failure: { code: "script_timeout", retryable: true },
})

const relearned = leaseRetryingJob(retrying, {
  token: leaseToken,
  leasedUntil: at("2026-08-13T00:09:00.000Z"),
  startedAt: at("2026-08-13T00:06:00.000Z"),
})

const succeeded = completeRunningJob(running, {
  episodeId,
  completedAt: at("2026-08-13T00:10:00.000Z"),
})

const failed = failRunningJob(running, {
  failedAt: at("2026-08-13T00:11:00.000Z"),
  failure: { code: "script_refusal", retryable: false },
})

const canceled = cancelJob(queued, {
  canceledAt: at("2026-08-13T00:12:00.000Z"),
  reason: "requested_by_user",
})

const roundTrip = (job: EpisodeJob) =>
  Effect.runSync(
    fromJobRow(
      toJobRow(job),
      toArticleRows(job).map((row) => row.articleId)
    )
  )

/**
 * 状態遷移表の全状態について、列への分解と復元が元の値と一致することを固定する。
 * document(JSON) 1列から実カラムへ移す変更で失われるものが無いことの担保。
 */
describe("episode job state columns", () => {
  const cases: readonly (readonly [string, EpisodeJob])[] = [
    ["Queued", queued],
    ["Queued with selected articles", queuedWithArticles],
    ["Running", running],
    ["Retrying", retrying],
    ["Running after retry lease", relearned],
    ["Succeeded", succeeded],
    ["Failed", failed],
    ["Canceled", canceled],
  ]

  it.each(cases)("round-trips a %s job without loss", (_name, job) => {
    expect(roundTrip(job)).toEqual(job)
  })

  it.each(cases)(
    "records the status of a %s job in its own column",
    (_name, job) => {
      expect(toJobRow(job).status).toBe(job._tag)
    }
  )

  it("leaves columns of other states null so no trace of the previous state remains", () => {
    const row = toJobRow(succeeded)

    expect(row.leaseToken).toBeNull()
    expect(row.leasedUntil).toBeNull()
    expect(row.retryAt).toBeNull()
    expect(row.failedAt).toBeNull()
    expect(row.failureCode).toBeNull()
    expect(row.canceledAt).toBeNull()
    expect(row.cancelReason).toBeNull()
  })

  it("keeps the lease on a running job so a worker can be fenced", () => {
    const row = toJobRow(running)

    expect(row.leaseToken).toBe(leaseToken)
    expect(row.leasedUntil).toBe("2026-08-13T00:05:00.000Z")
    expect(row.startedAt).toBe("2026-08-13T00:01:00.000Z")
  })

  it("distinguishes a retryable failure from a terminal one", () => {
    expect(toJobRow(retrying).failureRetryable).toBe(1)
    expect(toJobRow(failed).failureRetryable).toBe(0)
  })

  it("preserves the creation time across every transition", () => {
    for (const [, job] of cases) {
      expect(toJobRow(job).createdAt).toBe("2026-08-13T00:00:00.000Z")
    }
  })

  it("stores selected articles positionally so the order survives", () => {
    expect(toArticleRows(queuedWithArticles)).toEqual([
      { jobId, position: 0, articleId: articleIds[0] },
      { jobId, position: 1, articleId: articleIds[1] },
    ])
  })

  it("stores no article rows when the selection is automatic", () => {
    expect(toArticleRows(queued)).toEqual([])
  })

  it("keeps the idempotency fingerprint stable across a state transition", () => {
    // 状態が進んでも要求そのものは変わらないので、指紋は一致し続ける。
    expect(requestFingerprintOf(running)).toBe(requestFingerprintOf(queued))
    expect(toJobRow(succeeded).requestFingerprint).toBe(
      toJobRow(queued).requestFingerprint
    )
  })

  it("recovers a lease without consuming an attempt", () => {
    const recovered = recoverRunningJob(running as RunningJob, {
      token: "lease-2" as never,
      leasedUntil: at("2026-08-13T00:20:00.000Z"),
      startedAt: at("2026-08-13T00:15:00.000Z"),
    })

    expect(toJobRow(recovered).attempt).toBe(toJobRow(running).attempt)
    expect(roundTrip(recovered)).toEqual(recovered)
  })

  it("reports the moment each state was entered", () => {
    expect(statusOccurredAt(queued)).toBe("2026-08-13T00:00:00.000Z")
    expect(statusOccurredAt(running)).toBe("2026-08-13T00:01:00.000Z")
    expect(statusOccurredAt(retrying)).toBe("2026-08-13T00:02:00.000Z")
    expect(statusOccurredAt(succeeded)).toBe("2026-08-13T00:10:00.000Z")
    expect(statusOccurredAt(failed)).toBe("2026-08-13T00:11:00.000Z")
    expect(statusOccurredAt(canceled)).toBe("2026-08-13T00:12:00.000Z")
  })

  it("refuses to rebuild a job whose state columns are inconsistent", () => {
    // Running なのにリースが無い行は、状態機械としてあり得ない。
    const broken = { ...toJobRow(running), leaseToken: null }

    expect(() => Effect.runSync(fromJobRow(broken))).toThrow()
  })
})
