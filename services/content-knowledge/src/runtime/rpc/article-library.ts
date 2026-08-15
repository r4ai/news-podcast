import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  ArticleLibraryReplySchema,
  MessageEnvelopeSchema,
  parseArticleLibraryRequest,
  parseMessageEnvelope,
  subjects,
  type ArticleLibraryReply,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { OwnerIdSchema } from "../../domain/subscription.js"

type Delivery<E = never> = Readonly<{
  readonly subject: string
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, E>
}>

type Library = Readonly<
  Record<
    "list" | "find" | "markdown" | "patch" | "bulkPatch" | "facets",
    (input: unknown) => Effect.Effect<any, any>
  >
> &
  Readonly<{
    readonly archive: (input: unknown, context: any) => Effect.Effect<any, any>
  }>

type Dependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
}>
const rejected = (
  code: Extract<ArticleLibraryReply, { _tag: "Rejected" }>["code"]
): ArticleLibraryReply => deepFreeze({ _tag: "Rejected", code })

const correlated = <E>(
  delivery: Delivery<E>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: Dependencies
) =>
  parse(ArticleLibraryReplySchema)(payload).pipe(
    Effect.flatMap((trusted) =>
      parse(MessageEnvelopeSchema)({
        messageId: dependencies.newMessageId(),
        correlationId: request.correlationId,
        causationId: request.messageId,
        occurredAt: dependencies.now(),
        producer: "content-knowledge",
        traceparent: request.traceparent,
        actor: { _tag: "Service", service: "content-knowledge" },
        payload: trusted,
      })
    ),
    Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
    Effect.map(JSON.stringify),
    Effect.flatMap(delivery.reply)
  )

const toReply = (operation: string, value: any): ArticleLibraryReply => {
  if (operation === "List")
    return deepFreeze({
      _tag: "Listed",
      articles: value.items,
      nextCursor: value.nextCursor,
    }) as ArticleLibraryReply
  if (operation === "Find")
    return value._tag === "Found"
      ? deepFreeze({ _tag: "Found", article: value.article })
      : deepFreeze({ _tag: "NotFound" })
  if (operation === "Markdown")
    return value._tag === "Found"
      ? deepFreeze({ _tag: "Markdown", markdown: value.markdown })
      : deepFreeze({ _tag: "NotFound" })
  if (operation === "Patch")
    return value._tag === "Found"
      ? deepFreeze({ _tag: "Updated", article: value.article })
      : deepFreeze({ _tag: "NotFound" })
  if (operation === "BulkPatch")
    return deepFreeze({ _tag: "BulkUpdated", updated: value })
  if (operation === "Facets")
    return deepFreeze({ _tag: "Facets", facets: value })
  if (operation === "Archive") {
    if (value._tag === "NotFound") return deepFreeze({ _tag: "NotFound" })
    return deepFreeze({ _tag: "ArchiveTriggered", status: value._tag })
  }
  return rejected("INVALID_REQUEST")
}

const storageCode = (
  failure: unknown
): Extract<ArticleLibraryReply, { _tag: "Rejected" }>["code"] => {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    failure._tag === "InvalidRequest"
  )
    return "INVALID_REQUEST"
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    failure._tag === "MarkdownObjectFailed"
  )
    return "OBJECT_FAILURE"
  return "STORAGE_FAILURE"
}

/** Enforces owner identity at the message boundary; payloads can never select a tenant. */
export const makeArticleLibraryRpcHandler =
  (library: Library, dependencies: Dependencies) =>
  <E>(delivery: Delivery<E>) =>
    Effect.try({
      try: () => JSON.parse(delivery.payload) as unknown,
      catch: () => undefined,
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () =>
          delivery.reply(JSON.stringify(rejected("INVALID_REQUEST"))),
        onSuccess: (request) => {
          const reply = (payload: unknown) =>
            correlated(delivery, request, payload, dependencies)
          if (
            delivery.subject !== subjects.content.articleLibrary ||
            request.producer !== "gateway"
          )
            return reply(rejected("INVALID_REQUEST"))
          if (request.actor._tag !== "User")
            return reply(rejected("UNAUTHENTICATED"))
          return Effect.all([
            parse(OwnerIdSchema)(request.actor.userId),
            parseArticleLibraryRequest(request.payload).pipe(
              Effect.mapError(() => ({ _tag: "InvalidRequest" as const }))
            ),
          ]).pipe(
            Effect.flatMap(([ownerId, command]) => {
              const input =
                command.operation === "List" ||
                command.operation === "BulkPatch" ||
                command.operation === "Facets"
                  ? {
                      ownerId,
                      query: command.query,
                      ...(command.operation === "BulkPatch"
                        ? { patch: command.patch }
                        : {}),
                    }
                  : {
                      ownerId,
                      articleId: command.articleId,
                      ...(command.operation === "Patch"
                        ? { patch: command.patch }
                        : {}),
                    }
              const effect =
                command.operation === "List"
                  ? library.list(input)
                  : command.operation === "Find"
                    ? library.find(input)
                    : command.operation === "Markdown"
                      ? library.markdown(input)
                      : command.operation === "Patch"
                        ? library.patch(input)
                        : command.operation === "BulkPatch"
                          ? library.bulkPatch(input)
                          : command.operation === "Facets"
                            ? library.facets(input)
                            : library.archive(input, {
                                messageId: request.messageId,
                                correlationId: request.correlationId,
                                traceparent: request.traceparent,
                                actor: request.actor,
                              })
              return effect.pipe(
                Effect.map((value) => toReply(command.operation, value))
              )
            }),
            Effect.matchEffect({
              onFailure: (failure) => reply(rejected(storageCode(failure))),
              onSuccess: reply,
            })
          )
        },
      })
    )
