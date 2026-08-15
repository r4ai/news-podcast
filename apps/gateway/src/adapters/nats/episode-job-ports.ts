import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  CorrelationIdSchema,
  parseEpisodeJobControlReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  EpisodeJobPageSchema,
  EpisodeJobSchema,
  JobReceiptSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import { conflict, jobConflict, jobNotFound, unavailable } from "./problems.js"
import { decodeJson, type Transport } from "./transport.js"

/**
 * エピソード生成ジョブの投入・制御・リプレイ。
 * 上流の状態遷移ごとに分かれたタイムスタンプを、公開ビューの語彙へ射影する。
 */

export const ProductionCreateEpisodeJobResponseSchema = Schema.Union([
  Schema.Struct({
    protocolVersion: Schema.Literal("production.create-job.reply.v1"),
    _tag: Schema.Literal("Accepted"),
    correlationId: CorrelationIdSchema,
    jobId: Schema.String.check(Schema.isUUID(4)),
    state: Schema.Literal("Queued"),
  }),
  Schema.Struct({
    protocolVersion: Schema.Literal("production.create-job.reply.v1"),
    _tag: Schema.Literal("Rejected"),
    correlationId: Schema.NullOr(CorrelationIdSchema),
    code: Schema.String,
  }),
])

type ParsedControlReply = Effect.Success<
  ReturnType<typeof parseEpisodeJobControlReply>
>
type ParsedProductionJob = Extract<
  ParsedControlReply,
  { readonly _tag: "Found" }
>["job"]
type PublicEpisodeJob = Schema.Schema.Type<typeof EpisodeJobSchema>

const stateTimestamp = (job: ParsedProductionJob) => {
  switch (job.status) {
    case "queued":
      return job.enqueuedAt
    case "running":
      return job.startedAt
    case "retrying":
      return job.retryAt
    case "succeeded":
      return job.completedAt
    case "failed":
      return job.failedAt
    case "canceled":
      return job.canceledAt
  }
}

export const toEpisodeJob = (
  job: ParsedProductionJob
): Effect.Effect<PublicEpisodeJob, ReturnType<typeof unavailable>> =>
  parse(EpisodeJobSchema)({
    id: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    ...(job.articleIds === undefined ? {} : { articleIds: job.articleIds }),
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...(job.status === "running" ? { startedAt: job.startedAt } : {}),
    ...(job.status === "retrying" ? { nextAttemptAt: job.retryAt } : {}),
    ...(["succeeded", "failed", "canceled"].includes(job.status)
      ? { finishedAt: stateTimestamp(job) }
      : {}),
    ...(job.status === "succeeded" ? { episodeId: job.episodeId } : {}),
    ...(job.status === "retrying" || job.status === "failed"
      ? {
          failure: {
            code: job.failure.code,
            message: job.failure.code,
            retryable: job.failure.retryable,
          },
        }
      : {}),
  }).pipe(Effect.mapError(unavailable))

const requireFoundJob = (
  reply: ParsedControlReply
): Effect.Effect<
  PublicEpisodeJob,
  ReturnType<typeof unavailable> | ReturnType<typeof jobNotFound>
> => {
  if (reply._tag === "Found") return toEpisodeJob(reply.job)
  if (reply._tag === "NotFound") return Effect.fail(jobNotFound())
  return Effect.fail(unavailable())
}

const requireMutatedJob = (
  reply: ParsedControlReply,
  tag: "Canceled" | "Retried"
): Effect.Effect<
  PublicEpisodeJob,
  | ReturnType<typeof unavailable>
  | ReturnType<typeof jobNotFound>
  | ReturnType<typeof jobConflict>
> => {
  if (reply._tag === tag) return toEpisodeJob(reply.job)
  if (reply._tag === "NotFound") return Effect.fail(jobNotFound())
  if (reply._tag === "Conflict") return Effect.fail(jobConflict(reply.code))
  return Effect.fail(unavailable())
}

type EpisodeJobPorts = Pick<
  GatewayPorts,
  | "createEpisodeJob"
  | "listEpisodeJobs"
  | "getEpisodeJob"
  | "cancelEpisodeJob"
  | "retryEpisodeJob"
  | "replayEpisodeJobEvents"
>

export const makeEpisodeJobPorts = (transport: Transport): EpisodeJobPorts => {
  const control = (
    headers: Parameters<GatewayPorts["getEpisodeJob"]>[0]["headers"],
    subject: string,
    payload: unknown
  ) =>
    transport.ownerRpc(
      headers,
      subject,
      "episode-production",
      payload,
      parseEpisodeJobControlReply
    )

  return {
    createEpisodeJob: ({ headers, payload }) =>
      transport.authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = transport.childLineage(
            parent,
            transport.nextMessageId()
          )
          return transport
            .send(
              subjects.production.createJob,
              actor,
              {
                idempotencyKey: headers["idempotency-key"],
                trigger: payload.trigger,
                ...(payload.articleIds === undefined
                  ? {}
                  : { articleIds: payload.articleIds }),
              },
              lineage
            )
            .pipe(
              Effect.flatMap(decodeJson),
              Effect.flatMap(parse(ProductionCreateEpisodeJobResponseSchema)),
              Effect.filterOrFail(
                (reply) => reply.correlationId === lineage.correlationId,
                unavailable
              ),
              Effect.mapError(unavailable)
            )
        }),
        Effect.flatMap((reply) =>
          reply._tag === "Accepted"
            ? parse(JobReceiptSchema)({
                id: reply.jobId,
                status: "queued",
                createdAt: transport.now(),
                attempt: 0,
                maxAttempts: 4,
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(
                reply.code === "IDEMPOTENCY_CONFLICT"
                  ? conflict()
                  : unavailable()
              )
        )
      ),
    listEpisodeJobs: ({ headers, limit }) =>
      control(headers, subjects.production.listJobs, {
        ...(limit === undefined ? {} : { limit }),
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Listed"
            ? Effect.forEach(reply.jobs, toEpisodeJob).pipe(
                Effect.flatMap((items) =>
                  parse(EpisodeJobPageSchema)({
                    items,
                    page: { hasMore: false },
                  })
                ),
                Effect.mapError(unavailable)
              )
            : Effect.fail(unavailable())
        )
      ),
    getEpisodeJob: ({ headers, jobId }) =>
      control(headers, subjects.production.getJob, { jobId }).pipe(
        Effect.flatMap(requireFoundJob)
      ),
    cancelEpisodeJob: ({ headers, jobId }) =>
      control(headers, subjects.production.cancelJob, { jobId }).pipe(
        Effect.flatMap((reply) => requireMutatedJob(reply, "Canceled"))
      ),
    retryEpisodeJob: ({ headers, jobId, idempotencyKey }) =>
      control(headers, subjects.production.retryJob, {
        jobId,
        idempotencyKey,
      }).pipe(
        Effect.flatMap((reply) => requireMutatedJob(reply, "Retried")),
        Effect.flatMap((job) =>
          parse(JobReceiptSchema)({
            id: job.id,
            status: job.status,
            createdAt: job.createdAt,
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
          }).pipe(Effect.mapError(unavailable))
        )
      ),
    // 現在値とイベント列を同じ相関IDの兄弟リクエストとして一度に取りに行く。
    replayEpisodeJobEvents: ({ headers, jobId, afterSequence }) =>
      transport.authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const requestControl = (subject: string, payload: unknown) => {
            const lineage = transport.childLineage(
              parent,
              transport.nextMessageId()
            )
            return transport
              .rpc(subject, "episode-production", actor, payload, lineage)
              .pipe(
                Effect.flatMap((reply) =>
                  parseEpisodeJobControlReply(reply.payload)
                ),
                Effect.mapError(unavailable)
              )
          }
          return Effect.all([
            requestControl(subjects.production.getJob, { jobId }),
            requestControl(subjects.production.listJobEvents, {
              jobId,
              afterSequence,
              limit: 100,
            }),
          ])
        }),
        Effect.flatMap(([current, replay]) =>
          Effect.all({
            snapshot: requireFoundJob(current),
            events:
              replay._tag === "Events"
                ? Effect.forEach(replay.events, ({ sequence, job }) =>
                    toEpisodeJob(job).pipe(
                      Effect.map((projected) => ({ sequence, job: projected }))
                    )
                  )
                : replay._tag === "NotFound"
                  ? Effect.fail(jobNotFound())
                  : Effect.fail(unavailable()),
          })
        ),
        Effect.map(deepFreeze)
      ),
  }
}
