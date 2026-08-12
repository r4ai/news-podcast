import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  CreateAudioAccessReplySchema,
  EpisodeLibraryRejectionSchema,
  ListEpisodesReplySchema,
  MessageEnvelopeSchema,
  parseCreateAudioAccessRequest,
  parseListEpisodesRequest,
  parseMessageEnvelope,
  subjects,
  type CreateAudioAccessReply,
  type EpisodeLibraryRejection,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  issueAudioAccess,
  listCompletedEpisodes,
} from "../application/episode-library.js"
import {
  decodeEpisodePageCursor,
  encodeEpisodePageCursor,
} from "../adapters/episode-page-cursor.js"
import type {
  AudioAccessSigner,
  CompletedEpisodeReader,
  EpisodePagePosition,
} from "../application/ports.js"
import { OwnerIdSchema, type EpisodeSource } from "../domain/episode.js"

export type EpisodeLibraryRpcDelivery<ReplyError = never> = Readonly<{
  subject: string
  payload: string
  reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

export type EpisodeLibraryRpcDependencies = Readonly<{
  newMessageId: () => string
  now: () => string
  nowEpochMillis: () => number
}>

const rejection = (code: EpisodeLibraryRejection["code"]) =>
  deepFreeze({ _tag: "Rejected" as const, code })

const parseOwnerId = parse(OwnerIdSchema)

const decodeJson = (payload: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(payload),
    catch: () => rejection("INVALID_REQUEST"),
  })

const replySchema = (subject: string) =>
  subject === subjects.library.listEpisodes
    ? ListEpisodesReplySchema
    : CreateAudioAccessReplySchema

const rawRejection = <ReplyError>(
  delivery: EpisodeLibraryRpcDelivery<ReplyError>,
  value: EpisodeLibraryRejection
) =>
  parse(EpisodeLibraryRejectionSchema)(value).pipe(
    Effect.flatMap((parsed) => delivery.reply(JSON.stringify(parsed)))
  )

const correlatedReply = <ReplyError>(
  delivery: EpisodeLibraryRpcDelivery<ReplyError>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: EpisodeLibraryRpcDependencies
) =>
  parse(replySchema(delivery.subject))(payload).pipe(
    Effect.flatMap((trustedPayload) =>
      parse(MessageEnvelopeSchema)({
        messageId: dependencies.newMessageId(),
        correlationId: request.correlationId,
        causationId: request.messageId,
        occurredAt: dependencies.now(),
        producer: "episode-library",
        traceparent: request.traceparent,
        actor: { _tag: "Service", service: "episode-library" },
        payload: trustedPayload,
      }).pipe(
        Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
        Effect.map(JSON.stringify),
        Effect.flatMap(delivery.reply)
      )
    )
  )

const wireEpisode = (episode: {
  readonly id: string
  readonly title: string
  readonly script: string
  readonly sources: readonly EpisodeSource[]
  readonly createdAt: string
}) =>
  deepFreeze({
    id: episode.id,
    title: episode.title,
    script: episode.script,
    createdAt: episode.createdAt,
    sources: episode.sources.map((source) =>
      source._tag === "RssSource"
        ? deepFreeze({
            sourceKind: "rss" as const,
            url: source.url,
            title: source.title,
            snapshotId: source.snapshotId,
            ...(source.publishedAt === undefined
              ? {}
              : { publishedAt: source.publishedAt }),
          })
        : deepFreeze({
            sourceKind: "web" as const,
            url: source.url,
            title: source.title,
          })
    ),
  })

const failureCode = (failure: unknown): EpisodeLibraryRejection["code"] =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "AudioAccessSigningFailure"
    ? "SIGNING_FAILURE"
    : typeof failure === "object" &&
        failure !== null &&
        "_tag" in failure &&
        failure._tag === "EpisodeLibraryStorageFailure"
      ? "STORAGE_FAILURE"
      : "INTERNAL_ERROR"

export const makeEpisodeLibraryRpcHandler = (
  reader: CompletedEpisodeReader,
  signer: AudioAccessSigner,
  dependencies: EpisodeLibraryRpcDependencies
) => {
  const list = listCompletedEpisodes(reader)
  const audio = issueAudioAccess(reader, signer, dependencies.nowEpochMillis)

  return <ReplyError>(
    delivery: EpisodeLibraryRpcDelivery<ReplyError>
  ): Effect.Effect<void, ReplyError | unknown> =>
    decodeJson(delivery.payload).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () => rawRejection(delivery, rejection("INVALID_REQUEST")),
        onSuccess: (envelope) => {
          const reject = (code: EpisodeLibraryRejection["code"]) =>
            correlatedReply(delivery, envelope, rejection(code), dependencies)

          if (envelope.producer !== "gateway") return reject("INVALID_REQUEST")
          if (envelope.actor._tag !== "User") return reject("UNAUTHENTICATED")

          const owner = parseOwnerId(envelope.actor.userId).pipe(
            Effect.mapError(() => rejection("INVALID_REQUEST"))
          )
          if (delivery.subject === subjects.library.listEpisodes) {
            return Effect.all([
              owner,
              parseListEpisodesRequest(envelope.payload).pipe(
                Effect.mapError(() => rejection("INVALID_REQUEST"))
              ),
            ]).pipe(
              Effect.flatMap(([ownerId, request]) =>
                Effect.gen(function* () {
                  const after: EpisodePagePosition | undefined =
                    request.cursor === undefined
                      ? undefined
                      : yield* decodeEpisodePageCursor(request.cursor).pipe(
                          Effect.mapError(() => rejection("INVALID_REQUEST"))
                        )
                  return [ownerId, after] as const
                })
              ),
              Effect.flatMap(([ownerId, after]) =>
                list({
                  ownerId,
                  ...(after === undefined ? {} : { after }),
                })
              ),
              Effect.flatMap((page) =>
                parse(ListEpisodesReplySchema)(
                  deepFreeze({
                    _tag: "Listed",
                    page: {
                      items: page.items.map(wireEpisode),
                      page: {
                        hasMore: page.hasMore,
                        ...(page.next === undefined
                          ? {}
                          : {
                              nextCursor: encodeEpisodePageCursor(page.next),
                            }),
                      },
                    },
                  })
                )
              ),
              Effect.matchEffect({
                onFailure: (failure) =>
                  reject(
                    typeof failure === "object" &&
                      failure !== null &&
                      "code" in failure
                      ? (failure as EpisodeLibraryRejection).code
                      : failureCode(failure)
                  ),
                onSuccess: (reply) =>
                  correlatedReply(delivery, envelope, reply, dependencies),
              })
            )
          }
          if (delivery.subject === subjects.library.createAudioAccess) {
            return Effect.all([
              owner,
              parseCreateAudioAccessRequest(envelope.payload).pipe(
                Effect.mapError(() => rejection("INVALID_REQUEST"))
              ),
            ]).pipe(
              Effect.flatMap(([ownerId, request]) =>
                audio({ ownerId, episodeId: request.episodeId as never })
              ),
              Effect.flatMap((access) =>
                parse(CreateAudioAccessReplySchema)(
                  deepFreeze({ _tag: "Found", access })
                )
              ),
              Effect.matchEffect({
                onFailure: (failure) => {
                  const reply: CreateAudioAccessReply =
                    typeof failure === "object" &&
                    failure !== null &&
                    "_tag" in failure &&
                    failure._tag === "EpisodeNotFound"
                      ? deepFreeze({ _tag: "NotFound" })
                      : rejection(
                          typeof failure === "object" &&
                            failure !== null &&
                            "code" in failure
                            ? (failure as EpisodeLibraryRejection).code
                            : failureCode(failure)
                        )
                  return correlatedReply(
                    delivery,
                    envelope,
                    reply,
                    dependencies
                  )
                },
                onSuccess: (reply) =>
                  correlatedReply(delivery, envelope, reply, dependencies),
              })
            )
          }
          return reject("INVALID_REQUEST")
        },
      })
    )
}
