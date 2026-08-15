import { randomUUID } from "node:crypto"

import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  CreateEpisodeJobReplySchema,
  MessageEnvelopeSchema,
  matchesPeerPolicy,
  parseCreateEpisodeJobRequest,
  parseMessageEnvelope,
  subjects,
  type CreateEpisodeJobReply,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { createJob, type CreateJobPorts } from "../../application/create-job.js"
import { JobIdSchema, OwnerIdSchema } from "../../domain/episode-job.js"

const encodeReply = Schema.encodeSync(CreateEpisodeJobReplySchema)
const decodeReply = Schema.decodeUnknownSync(CreateEpisodeJobReplySchema)
const parseOwnerId = parse(OwnerIdSchema)

export type CreateJobRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

type RejectionCode = Extract<
  CreateEpisodeJobReply,
  { readonly _tag: "Rejected" }
>["code"]
const rejected = (code: RejectionCode): CreateEpisodeJobReply =>
  deepFreeze({ _tag: "Rejected" as const, code })

const accepted = (
  jobId: Schema.Schema.Type<typeof JobIdSchema>
): CreateEpisodeJobReply =>
  deepFreeze(
    decodeReply({
      _tag: "Accepted" as const,
      jobId,
      state: "Queued" as const,
    })
  )

const decodeJson = (payload: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(payload),
    catch: () => deepFreeze({ _tag: "InvalidJson" as const }),
  })

const rejectionForSaveFailure = (failure: unknown): RejectionCode =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "IdempotencyConflict"
    ? "IDEMPOTENCY_CONFLICT"
    : "INTERNAL_ERROR"

const replyWith = <ReplyError>(
  delivery: CreateJobRpcDelivery<ReplyError>,
  request: Effect.Success<ReturnType<typeof parseMessageEnvelope>>,
  reply: CreateEpisodeJobReply,
  dependencies: {
    readonly newMessageId: () => string
    readonly now: () => string
  }
) =>
  Effect.currentSpan.pipe(
    Effect.orDie,
    Effect.flatMap((span) =>
      parse(MessageEnvelopeSchema)({
        messageId: dependencies.newMessageId(),
        correlationId: request.correlationId,
        causationId: request.messageId,
        occurredAt: dependencies.now(),
        producer: "episode-production",
        traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
        actor: { _tag: "Service", service: "episode-production" },
        payload: encodeReply(reply),
      }).pipe(Effect.orDie)
    ),
    Effect.flatMap((envelope) =>
      Schema.encodeEffect(MessageEnvelopeSchema)(envelope).pipe(Effect.orDie)
    ),
    Effect.map(JSON.stringify),
    Effect.flatMap(delivery.reply)
  )

const rejectionLog = (
  code: RejectionCode,
  correlationId: string | null,
  messageId?: string
) =>
  Effect.logWarning("create job RPC rejected", {
    event_name: "episode.requested",
    rejection_code: code,
    correlation_id: correlationId ?? "unknown",
    ...(messageId === undefined ? {} : { message_id: messageId }),
  })

/**
 * NATS request/reply boundary. The payload never supplies an owner: only a
 * parsed User actor is converted into the domain OwnerId.
 */
export const handleCreateJobRpc = <SaveError>(
  ports: CreateJobPorts<SaveError> & {
    readonly replyDependencies?: {
      readonly newMessageId: () => string
      readonly now: () => string
    }
  }
) => {
  const useCase = createJob(ports)
  const replyDependencies = ports.replyDependencies ?? {
    newMessageId: randomUUID,
    now: () => new Date().toISOString(),
  }

  return <ReplyError>(
    delivery: CreateJobRpcDelivery<ReplyError>
  ): Effect.Effect<void, ReplyError> => {
    const invalidEnvelope = withMessagingSpan(
      rejectionLog("INVALID_REQUEST", null),
      subjects.production.createJob,
      "process"
    )

    return decodeJson(delivery.payload).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () => invalidEnvelope,
        onSuccess: (envelope) => {
          const reject = (code: RejectionCode) =>
            rejectionLog(code, envelope.correlationId, envelope.messageId).pipe(
              Effect.andThen(
                replyWith(delivery, envelope, rejected(code), replyDependencies)
              )
            )

          const process =
            envelope.actor._tag !== "User" ||
            !matchesPeerPolicy(envelope, {
              producer: "gateway",
              actor: "User",
            })
              ? reject("UNAUTHENTICATED")
              : Effect.all([
                  parseCreateEpisodeJobRequest(envelope.payload),
                  parseOwnerId(envelope.actor.userId),
                ]).pipe(
                  Effect.matchEffect({
                    onFailure: () => reject("INVALID_REQUEST"),
                    onSuccess: ([request, ownerId]) =>
                      useCase(
                        deepFreeze({
                          ownerId,
                          idempotencyKey: request.idempotencyKey,
                          trigger: request.trigger,
                          articleIds: request.articleIds,
                        })
                      ).pipe(
                        Effect.matchEffect({
                          onFailure: (failure) =>
                            reject(rejectionForSaveFailure(failure)),
                          onSuccess: (job) =>
                            Effect.logInfo("episode job accepted", {
                              event_name: "episode.requested",
                              job_id: job.jobId,
                              owner_id: job.request.ownerId,
                              correlation_id: envelope.correlationId,
                              message_id: envelope.messageId,
                            }).pipe(
                              Effect.andThen(
                                replyWith(
                                  delivery,
                                  envelope,
                                  accepted(job.jobId),
                                  replyDependencies
                                )
                              )
                            ),
                        })
                      ),
                  })
                )

          return withRemoteTraceparent(
            withMessagingSpan(
              process,
              subjects.production.createJob,
              "process"
            ),
            envelope.traceparent
          )
        },
      })
    )
  }
}
