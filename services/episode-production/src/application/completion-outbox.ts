import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import {
  EpisodeCompletedV2Schema,
  MessageEnvelopeSchema,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type {
  EpisodeCompletionIntent,
  PipelineFailure,
} from "./ports/execution.js"
import {
  UtcTimestampSchema,
  type JobId,
  type UtcTimestamp,
} from "../domain/episode-job.js"

const CompletionEnvelopeSchema = Schema.Struct({
  ...MessageEnvelopeSchema.fields,
  producer: Schema.Literal("episode-production"),
  actor: Schema.Struct({
    _tag: Schema.Literal("Service"),
    service: Schema.Literal("episode-production"),
  }),
  payload: EpisodeCompletedV2Schema,
})
const parseEnvelope = parse(CompletionEnvelopeSchema)
const encodeEnvelope = Schema.encodeSync(CompletionEnvelopeSchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

export type PendingCompletion = DeepReadonly<{
  jobId: JobId
  completion: EpisodeCompletionIntent
}>

export type CompletionOutboxPorts = Readonly<{
  listPending: (
    limit: number
  ) => Effect.Effect<readonly PendingCompletion[], PipelineFailure>
  publish: (input: {
    subject: typeof subjects.production.jobCompletedV2
    messageId: JobId
    payload: string
  }) => Effect.Effect<{ readonly duplicate: boolean }, PipelineFailure>
  markPublished: (
    jobId: JobId,
    publishedAt: UtcTimestamp
  ) => Effect.Effect<void, PipelineFailure>
  now: () => UtcTimestamp
}>

export type CompletionRelayResult = DeepReadonly<{
  published: number
  duplicates: number
}>

const envelopeFor = (pending: PendingCompletion) =>
  parseEnvelope({
    messageId: pending.jobId,
    correlationId: pending.jobId,
    causationId: pending.jobId,
    occurredAt: encodeTimestamp(pending.completion.completedAt),
    producer: "episode-production",
    traceparent: pending.completion.traceparent,
    actor: { _tag: "Service", service: "episode-production" },
    payload: {
      episodeId: pending.completion.episodeId,
      ownerId: pending.completion.ownerId,
      title: pending.completion.title,
      script: pending.completion.script,
      audio: {
        objectKey: pending.completion.audio.objectKey,
        byteLength: pending.completion.audio.byteLength,
        contentType: pending.completion.audio.contentType,
      },
      sources: pending.completion.sources.map((source) => ({
        sourceKind: "rss" as const,
        snapshotId: source.snapshotId,
        url: source.url,
        title: source.title,
        ...(source.publishedAt === undefined
          ? {}
          : { publishedAt: source.publishedAt }),
      })),
      completedAt: encodeTimestamp(pending.completion.completedAt),
    },
  }).pipe(
    Effect.mapError(() =>
      deepFreeze({
        _tag: "PipelineFailure" as const,
        code: "invalid_completion_outbox",
        retryable: false,
      })
    )
  )

/** Publishes first and marks only after JetStream acknowledgement. */
export const relayCompletionOutbox = (
  ports: CompletionOutboxPorts,
  limit = 50
): Effect.Effect<CompletionRelayResult, PipelineFailure> =>
  ports.listPending(limit).pipe(
    Effect.flatMap((pending) =>
      Effect.forEach(pending, (item) =>
        envelopeFor(item).pipe(
          Effect.map((envelope) =>
            JSON.stringify(
              encodeEnvelope(
                envelope as Schema.Schema.Type<typeof CompletionEnvelopeSchema>
              )
            )
          ),
          Effect.flatMap((payload) =>
            ports.publish({
              subject: subjects.production.jobCompletedV2,
              messageId: item.jobId,
              payload,
            })
          ),
          Effect.tap(() => ports.markPublished(item.jobId, ports.now()))
        )
      )
    ),
    Effect.map((acks) =>
      deepFreeze({
        published: acks.length,
        duplicates: acks.filter((ack) => ack.duplicate).length,
      })
    )
  )
