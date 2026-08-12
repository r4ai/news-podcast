import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  MessageEnvelopeSchema,
  ReadingDictionaryReplySchema,
  parseMessageEnvelope,
  parseReadingDictionaryRequest,
  subjects,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  createReadingDictionaryEntry,
  deleteReadingDictionaryEntry,
  listReadingDictionaryEntries,
  updateReadingDictionaryEntry,
  type ReadingDictionaryRepository,
} from "../application/reading-dictionary.js"
import {
  OwnerIdSchema,
  UtcTimestampSchema,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import {
  ReadingDictionaryEntrySchema,
  ReadingDictionaryIdSchema,
  type ReadingDictionaryEntry,
  type ReadingDictionaryId,
} from "../domain/reading-dictionary.js"

export type ReadingDictionaryRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

export type ReadingDictionaryRpcDependencies = Readonly<{
  readonly newId: () => ReadingDictionaryId
  readonly newMessageId: () => string
  readonly now: () => UtcTimestamp
}>

const rejected = (
  code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "STORAGE_FAILURE"
) => deepFreeze({ _tag: "Rejected" as const, code })

const toWireEntry = (entry: ReadingDictionaryEntry) => {
  const encoded = Schema.encodeSync(ReadingDictionaryEntrySchema)(entry)
  return deepFreeze({
    id: encoded.id,
    surface: encoded.surface,
    reading: encoded.reading,
    accentType: encoded.accentType,
    source: encoded.source,
    ...(encoded.episodeJobId === null
      ? {}
      : { episodeJobId: encoded.episodeJobId }),
    createdAt: encoded.createdAt,
    updatedAt: encoded.updatedAt,
  })
}

const rawInvalid = <E>(delivery: ReadingDictionaryRpcDelivery<E>) =>
  delivery.reply(JSON.stringify(rejected("INVALID_REQUEST")))

const correlated = <E>(
  delivery: ReadingDictionaryRpcDelivery<E>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: ReadingDictionaryRpcDependencies
) =>
  parse(ReadingDictionaryReplySchema)(payload).pipe(
    Effect.flatMap((trusted) =>
      Effect.currentSpan.pipe(
        Effect.flatMap((span) =>
          parse(MessageEnvelopeSchema)({
            messageId: dependencies.newMessageId(),
            correlationId: request.correlationId,
            causationId: request.messageId,
            occurredAt: Schema.encodeSync(UtcTimestampSchema)(
              dependencies.now()
            ),
            producer: "episode-production",
            traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
            actor: { _tag: "Service", service: "episode-production" },
            payload: trusted,
          })
        )
      )
    ),
    Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
    Effect.map(JSON.stringify),
    Effect.flatMap(delivery.reply)
  )

/** Owner-scoped dictionary RPC. Owner identity is derived only from the Actor. */
export const makeReadingDictionaryRpcHandler =
  (
    repository: ReadingDictionaryRepository,
    dependencies: ReadingDictionaryRpcDependencies
  ) =>
  <E>(delivery: ReadingDictionaryRpcDelivery<E>) =>
    Effect.try({
      try: () => JSON.parse(delivery.payload) as unknown,
      catch: () => undefined,
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () => rawInvalid(delivery),
        onSuccess: (request) => {
          const reply = (payload: unknown) =>
            correlated(delivery, request, payload, dependencies)
          const process =
            request.producer !== "gateway"
              ? reply(rejected("INVALID_REQUEST"))
              : request.actor._tag !== "User"
                ? reply(rejected("UNAUTHENTICATED"))
                : Effect.all([
                    parse(OwnerIdSchema)(request.actor.userId),
                    parseReadingDictionaryRequest(request.payload),
                  ]).pipe(
                    Effect.flatMap(
                      ([ownerId, command]): Effect.Effect<
                        unknown,
                        unknown,
                        never
                      > => {
                        switch (command.operation) {
                          case "List":
                            return listReadingDictionaryEntries(
                              repository,
                              ownerId
                            ).pipe(
                              Effect.map((entries) => ({
                                _tag: "Entries" as const,
                                entries: entries.map(toWireEntry),
                              }))
                            )
                          case "Create":
                            return createReadingDictionaryEntry(
                              {
                                create: repository.create,
                                nextId: Effect.sync(dependencies.newId),
                                now: Effect.sync(dependencies.now),
                              },
                              { ownerId, ...command }
                            ).pipe(
                              Effect.map((result) =>
                                result._tag === "Conflict"
                                  ? { _tag: "Conflict" as const }
                                  : {
                                      _tag: "Entry" as const,
                                      entry: toWireEntry(result.entry),
                                    }
                              )
                            )
                          case "Update":
                            return updateReadingDictionaryEntry(
                              {
                                update: repository.update,
                                now: Effect.sync(dependencies.now),
                              },
                              { ownerId, id: command.id, patch: command.patch }
                            ).pipe(
                              Effect.map((result) =>
                                result._tag === "Updated"
                                  ? {
                                      _tag: "Entry" as const,
                                      entry: toWireEntry(result.entry),
                                    }
                                  : { _tag: result._tag }
                              )
                            )
                          case "Delete":
                            return parse(ReadingDictionaryIdSchema)(
                              command.id
                            ).pipe(
                              Effect.flatMap((id) =>
                                deleteReadingDictionaryEntry(
                                  repository,
                                  ownerId,
                                  id
                                )
                              )
                            )
                        }
                      }
                    ),
                    Effect.matchEffect({
                      onFailure: (failure) =>
                        reply(
                          rejected(
                            typeof failure === "object" &&
                              failure !== null &&
                              "_tag" in failure &&
                              failure._tag === "ReadingDictionaryStoreFailed"
                              ? "STORAGE_FAILURE"
                              : "INVALID_REQUEST"
                          )
                        ),
                      onSuccess: reply,
                    })
                  )

          return withRemoteTraceparent(
            withMessagingSpan(
              process,
              subjects.production.readingDictionary,
              "process"
            ),
            request.traceparent
          )
        },
      })
    )
