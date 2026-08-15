import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  CorrelationIdSchema,
  parseCreateEpisodeJobRequest,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { createJob, type CreateJobPorts } from "../../application/create-job.js"
import { JobIdSchema, OwnerIdSchema } from "../../domain/episode-job.js"

const replyVersion = "production.create-job.reply.v1" as const

export const CreateJobRpcReplySchema = Schema.Union([
  Schema.Struct({
    protocolVersion: Schema.Literal(replyVersion),
    _tag: Schema.Literal("Accepted"),
    correlationId: CorrelationIdSchema,
    jobId: JobIdSchema,
    state: Schema.Literal("Queued"),
  }),
  Schema.Struct({
    protocolVersion: Schema.Literal(replyVersion),
    _tag: Schema.Literal("Rejected"),
    correlationId: Schema.NullOr(CorrelationIdSchema),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "IDEMPOTENCY_CONFLICT",
      "INTERNAL_ERROR",
    ]),
  }),
])
export type CreateJobRpcReply = Schema.Schema.Type<
  typeof CreateJobRpcReplySchema
>

const encodeReply = Schema.encodeSync(CreateJobRpcReplySchema)
const parseOwnerId = parse(OwnerIdSchema)

export type CreateJobRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

type RejectionCode = Extract<
  CreateJobRpcReply,
  { readonly _tag: "Rejected" }
>["code"]
type ReplyCorrelation = Extract<
  CreateJobRpcReply,
  { readonly _tag: "Rejected" }
>["correlationId"]

const rejected = (
  code: RejectionCode,
  correlationId: ReplyCorrelation
): CreateJobRpcReply =>
  deepFreeze({
    protocolVersion: replyVersion,
    _tag: "Rejected" as const,
    correlationId,
    code,
  })

const accepted = (
  correlationId: Schema.Schema.Type<typeof CorrelationIdSchema>,
  jobId: Schema.Schema.Type<typeof JobIdSchema>
): CreateJobRpcReply =>
  deepFreeze({
    protocolVersion: replyVersion,
    _tag: "Accepted" as const,
    correlationId,
    jobId,
    state: "Queued" as const,
  })

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
  reply: CreateJobRpcReply
) => delivery.reply(JSON.stringify(encodeReply(reply)))

const rejectionLog = (
  code: RejectionCode,
  correlationId: ReplyCorrelation,
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
  ports: CreateJobPorts<SaveError>
) => {
  const useCase = createJob(ports)

  return <ReplyError>(
    delivery: CreateJobRpcDelivery<ReplyError>
  ): Effect.Effect<void, ReplyError> => {
    const invalidEnvelope = withMessagingSpan(
      rejectionLog("INVALID_REQUEST", null).pipe(
        Effect.andThen(replyWith(delivery, rejected("INVALID_REQUEST", null)))
      ),
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
                replyWith(delivery, rejected(code, envelope.correlationId))
              )
            )

          const process =
            envelope.actor._tag !== "User"
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
                          ...(request.articleIds === undefined
                            ? {}
                            : { articleIds: request.articleIds }),
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
                                  accepted(envelope.correlationId, job.jobId)
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
