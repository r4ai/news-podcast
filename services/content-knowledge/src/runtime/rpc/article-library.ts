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
import type { makeArticleLibraryHandler } from "./article-library-handler.js"

type Delivery<E = never> = Readonly<{
  readonly subject: string
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, E>
}>

type Library = ReturnType<typeof makeArticleLibraryHandler>

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
            Effect.flatMap(
              ([ownerId, command]): Effect.Effect<unknown, unknown, never> => {
                switch (command.operation) {
                  case "List":
                    return library.list({ ownerId, query: command.query }).pipe(
                      Effect.map((value) =>
                        deepFreeze({
                          _tag: "Listed",
                          articles: value.items,
                          nextCursor: value.nextCursor,
                        })
                      )
                    )
                  case "Find":
                    return library
                      .find({ ownerId, articleId: command.articleId })
                      .pipe(
                        Effect.map((value) =>
                          value._tag === "Found"
                            ? deepFreeze({
                                _tag: "Found",
                                article: value.article,
                              })
                            : deepFreeze({ _tag: "NotFound" })
                        )
                      )
                  case "Markdown":
                    return library
                      .markdown({ ownerId, articleId: command.articleId })
                      .pipe(
                        Effect.map((value) =>
                          value._tag === "Found"
                            ? deepFreeze({
                                _tag: "Markdown",
                                markdown: value.markdown,
                              })
                            : deepFreeze({ _tag: "NotFound" })
                        )
                      )
                  case "Patch":
                    return library
                      .patch({
                        ownerId,
                        articleId: command.articleId,
                        patch: command.patch,
                      })
                      .pipe(
                        Effect.map((value) =>
                          value._tag === "Found"
                            ? deepFreeze({
                                _tag: "Updated",
                                article: value.article,
                              })
                            : deepFreeze({ _tag: "NotFound" })
                        )
                      )
                  case "BulkPatch":
                    return library
                      .bulkPatch({
                        ownerId,
                        query: command.query,
                        patch: command.patch,
                      })
                      .pipe(
                        Effect.map((updated) =>
                          deepFreeze({ _tag: "BulkUpdated", updated })
                        )
                      )
                  case "Facets":
                    return library
                      .facets({ ownerId, query: command.query })
                      .pipe(
                        Effect.map((facets) =>
                          deepFreeze({ _tag: "Facets", facets })
                        )
                      )
                  case "Archive":
                    return library
                      .archive(
                        { ownerId, articleId: command.articleId },
                        {
                          messageId: request.messageId,
                          correlationId: request.correlationId,
                          traceparent: request.traceparent,
                          actor: request.actor,
                        }
                      )
                      .pipe(
                        Effect.map((value) =>
                          value._tag === "NotFound"
                            ? deepFreeze({ _tag: "NotFound" })
                            : deepFreeze({
                                _tag: "ArchiveTriggered",
                                status: value._tag,
                              })
                        )
                      )
                }
              }
            ),
            Effect.matchEffect({
              onFailure: (failure) => reply(rejected(storageCode(failure))),
              onSuccess: reply,
            })
          )
        },
      })
    )
