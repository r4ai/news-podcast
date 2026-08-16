import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  EpisodeJobSchema,
  type EpisodeJob,
} from "../../../domain/episode-job.js"

/**
 * ドメインの状態機械と、正規化された episode_jobs 行との相互変換。
 *
 * 状態ごとに「意味のある列」は異なるが、行は全ての列を持つ。
 * どの状態でどの列が埋まるかの唯一の定義がここにある。
 */

export type JobStatus = EpisodeJob["_tag"]

export type EpisodeJobRow = {
  jobId: string
  ownerId: string
  idempotencyKey: string
  requestFingerprint: string
  trigger: "manual" | "scheduled"
  status: JobStatus
  attempt: number
  createdAt: string
  enqueuedAt: string | null
  startedAt: string | null
  retryAt: string | null
  completedAt: string | null
  failedAt: string | null
  canceledAt: string | null
  leaseToken: string | null
  leasedUntil: string | null
  failureCode: string | null
  failureRetryable: number | null
  episodeId: string | null
  cancelReason: "requested_by_user" | "service_shutdown" | null
  currentStage?:
    | "selecting_articles"
    | "materializing_articles"
    | "generating_script"
    | "preparing_pronunciation"
    | "synthesizing_audio"
    | "storing_episode"
    | null
}

const encodeJob = Schema.encodeSync(EpisodeJobSchema)
const parseJob = parse(EpisodeJobSchema)

type StateColumns = Pick<
  EpisodeJobRow,
  | "enqueuedAt"
  | "startedAt"
  | "retryAt"
  | "completedAt"
  | "failedAt"
  | "canceledAt"
  | "leaseToken"
  | "leasedUntil"
  | "failureCode"
  | "failureRetryable"
  | "episodeId"
  | "cancelReason"
>

/** 状態に対応しない列は必ずNULLへ戻す。前の状態の痕跡を残さない。 */
const emptyStateColumns: StateColumns = {
  enqueuedAt: null,
  startedAt: null,
  retryAt: null,
  completedAt: null,
  failedAt: null,
  canceledAt: null,
  leaseToken: null,
  leasedUntil: null,
  failureCode: null,
  failureRetryable: null,
  episodeId: null,
  cancelReason: null,
}

const stateColumnsOf = (job: ReturnType<typeof encodeJob>): StateColumns => {
  switch (job._tag) {
    case "Queued":
      return { ...emptyStateColumns, enqueuedAt: job.enqueuedAt }
    case "Running":
      return {
        ...emptyStateColumns,
        startedAt: job.startedAt,
        leaseToken: job.lease.token,
        leasedUntil: job.lease.leasedUntil,
      }
    case "Retrying":
      return {
        ...emptyStateColumns,
        retryAt: job.retryAt,
        failureCode: job.failure.code,
        failureRetryable: 1,
      }
    case "Succeeded":
      return {
        ...emptyStateColumns,
        completedAt: job.completedAt,
        episodeId: job.episodeId,
      }
    case "Failed":
      return {
        ...emptyStateColumns,
        failedAt: job.failedAt,
        failureCode: job.failure.code,
        failureRetryable: 0,
      }
    case "Canceled":
      return {
        ...emptyStateColumns,
        canceledAt: job.canceledAt,
        cancelReason: job.reason,
      }
  }
}

/**
 * 冪等キーの一致判定に使う指紋。選択記事の順序差で別要求と誤認しないよう、
 * ドメイン側が整列済みの request をそのまま直列化する。
 */
export const requestFingerprintOf = (job: EpisodeJob): string =>
  JSON.stringify(encodeJob(job).request)

export const toJobRow = (job: EpisodeJob): EpisodeJobRow => {
  const encoded = encodeJob(job)
  return {
    jobId: encoded.jobId,
    ownerId: encoded.request.ownerId,
    idempotencyKey: encoded.request.idempotencyKey,
    requestFingerprint: JSON.stringify(encoded.request),
    trigger: encoded.request.trigger,
    status: encoded._tag,
    attempt: encoded.attempt,
    createdAt: encoded.createdAt,
    ...stateColumnsOf(encoded),
  }
}

/** 依頼で選ばれた記事は子テーブルへ。順序は指紋に影響するので位置で保つ。 */
export const toArticleRows = (
  job: EpisodeJob
): readonly { jobId: string; position: number; articleId: string }[] => {
  const articleIds = encodeJob(job).request.articleIds
  if (articleIds === undefined) return []
  return articleIds.map((articleId, position) => ({
    jobId: encodeJob(job).jobId,
    position,
    articleId,
  }))
}

const baseFields = (row: EpisodeJobRow, articleIds: readonly string[]) => ({
  jobId: row.jobId,
  createdAt: row.createdAt,
  request: {
    ownerId: row.ownerId,
    idempotencyKey: row.idempotencyKey,
    trigger: row.trigger,
    ...(articleIds.length === 0 ? {} : { articleIds }),
  },
})

const documentOf = (row: EpisodeJobRow, articleIds: readonly string[]) => {
  const base = baseFields(row, articleIds)
  switch (row.status) {
    case "Queued":
      return {
        ...base,
        _tag: "Queued",
        attempt: row.attempt,
        enqueuedAt: row.enqueuedAt,
      }
    case "Running":
      return {
        ...base,
        _tag: "Running",
        attempt: row.attempt,
        startedAt: row.startedAt,
        lease: { token: row.leaseToken, leasedUntil: row.leasedUntil },
      }
    case "Retrying":
      return {
        ...base,
        _tag: "Retrying",
        attempt: row.attempt,
        retryAt: row.retryAt,
        failure: { code: row.failureCode, retryable: true },
      }
    case "Succeeded":
      return {
        ...base,
        _tag: "Succeeded",
        attempt: row.attempt,
        episodeId: row.episodeId,
        completedAt: row.completedAt,
      }
    case "Failed":
      return {
        ...base,
        _tag: "Failed",
        attempt: row.attempt,
        failedAt: row.failedAt,
        failure: { code: row.failureCode, retryable: false },
      }
    case "Canceled":
      return {
        ...base,
        _tag: "Canceled",
        attempt: row.attempt,
        canceledAt: row.canceledAt,
        reason: row.cancelReason,
      }
  }
}

/**
 * 行からドメインへ戻す。列の欠損は状態機械の不変条件違反なので、
 * ここでは補完せず Schema の検証に失敗させる。
 */
export const fromJobRow = (
  row: EpisodeJobRow,
  articleIds: readonly string[] = []
): Effect.Effect<EpisodeJob, unknown> => parseJob(documentOf(row, articleIds))

/** ストリーミング契約のため、状態イベントには当時の姿をJSONで残す。 */
export const toStatusEventDocument = (job: EpisodeJob): string =>
  JSON.stringify(encodeJob(job))

export const statusOccurredAt = (job: EpisodeJob): string => {
  const encoded = encodeJob(job)
  switch (encoded._tag) {
    case "Queued":
      return encoded.enqueuedAt
    case "Running":
      return encoded.startedAt
    case "Retrying":
      return encoded.retryAt
    case "Succeeded":
      return encoded.completedAt
    case "Failed":
      return encoded.failedAt
    case "Canceled":
      return encoded.canceledAt
  }
}

export const freezeJob = (job: EpisodeJob): EpisodeJob =>
  deepFreeze(job) as EpisodeJob

const decodeJobSync = Schema.decodeUnknownSync(EpisodeJobSchema)

/**
 * 既存アダプタは document(JSON文字列) を受け渡す契約のままである。
 * 正規化はこの層で吸収し、上位の振る舞いを変えない。
 */
export const documentToRow = (document: string): EpisodeJobRow =>
  toJobRow(decodeJobSync(JSON.parse(document) as unknown))

export const documentArticleIds = (document: string): readonly string[] =>
  toArticleRows(decodeJobSync(JSON.parse(document) as unknown)).map(
    (row) => row.articleId
  )

export const rowToDocument = (
  row: EpisodeJobRow,
  articleIds: readonly string[] = []
): string => JSON.stringify(documentOf(row, articleIds))
