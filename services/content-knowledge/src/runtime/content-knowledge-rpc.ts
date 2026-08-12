import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  AddFeedSubscriptionReplySchema,
  ContentKnowledgeRejectionSchema,
  DeleteFeedSubscriptionReplySchema,
  ListFeedCatalogReplySchema,
  ListFeedSubscriptionsReplySchema,
  MaterializeArticlesReplySchema,
  UpdateFeedSubscriptionReplySchema,
  MessageEnvelopeSchema,
  parseAddFeedSubscriptionRequest,
  parseDeleteFeedSubscriptionRequest,
  parseListFeedCatalogRequest,
  parseListFeedSubscriptionsRequest,
  parseMaterializeArticlesRequest,
  parseUpdateFeedSubscriptionRequest,
  parseMessageEnvelope,
  subjects,
  type ContentKnowledgeRejection,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { SubscriptionRepository } from "../application/subscription-ports.js"
import type {
  MaterializeResult,
  MaterializeSelection,
} from "../application/materialize-articles.js"
import { ArticleIdSchema } from "../domain/article.js"
import type { OwnerId } from "../domain/subscription.js"
import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"

export type ContentKnowledgeRpcDelivery<ReplyError = never> = Readonly<{
  readonly subject: string
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

export type ContentKnowledgeRpcDependencies = Readonly<{
  readonly newSubscriptionIdentity: () => Readonly<{
    readonly subscriptionId: Schema.Schema.Type<typeof SubscriptionIdSchema>
    readonly feedId: Schema.Schema.Type<typeof FeedIdSchema>
  }>
  readonly newMessageId: () => string
  readonly now: () => string
}>

type Materialize = (input: {
  readonly ownerId: OwnerId
  readonly selection: MaterializeSelection
}) => Effect.Effect<MaterializeResult, unknown>

const rejection = (
  code: ContentKnowledgeRejection["code"]
): ContentKnowledgeRejection => deepFreeze({ _tag: "Rejected", code })
const parseOwner = parse(OwnerIdSchema)

const replySchema = (subject: string) => {
  switch (subject) {
    case subjects.content.addSubscription:
      return AddFeedSubscriptionReplySchema
    case subjects.content.listSubscriptions:
      return ListFeedSubscriptionsReplySchema
    case subjects.content.deleteSubscription:
      return DeleteFeedSubscriptionReplySchema
    case subjects.content.updateSubscription:
      return UpdateFeedSubscriptionReplySchema
    case subjects.content.listFeedCatalog:
      return ListFeedCatalogReplySchema
    case subjects.content.materializeArticles:
      return MaterializeArticlesReplySchema
    default:
      return ContentKnowledgeRejectionSchema
  }
}

const rawReject = <ReplyError>(
  delivery: ContentKnowledgeRpcDelivery<ReplyError>,
  code: ContentKnowledgeRejection["code"]
) => delivery.reply(JSON.stringify(rejection(code)))

const correlatedReply = <ReplyError>(
  delivery: ContentKnowledgeRpcDelivery<ReplyError>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: ContentKnowledgeRpcDependencies
) =>
  parse(replySchema(delivery.subject))(payload).pipe(
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

const wireSubscription = (value: {
  readonly subscriptionId: string
  readonly feedId: string
  readonly feedUrl: string
  readonly enabled?: boolean
  readonly createdAt: string
}) =>
  deepFreeze({
    subscriptionId: value.subscriptionId,
    feedId: value.feedId,
    feedUrl: value.feedUrl,
    enabled: value.enabled ?? true,
    createdAt: value.createdAt,
  })

const storageCode = (failure: unknown): ContentKnowledgeRejection["code"] =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "MarkdownObjectFailed"
    ? "OBJECT_FAILURE"
    : "STORAGE_FAILURE"

const failureCode = (failure: unknown): ContentKnowledgeRejection["code"] => {
  if (typeof failure === "object" && failure !== null && "code" in failure) {
    const code = failure.code
    if (
      code === "INVALID_REQUEST" ||
      code === "UNAUTHENTICATED" ||
      code === "NOT_FOUND" ||
      code === "STORAGE_FAILURE" ||
      code === "OBJECT_FAILURE" ||
      code === "INTERNAL_ERROR"
    )
      return code
  }
  return storageCode(failure)
}

export const makeContentKnowledgeRpcHandler =
  (
    subscriptions: SubscriptionRepository,
    materialize: Materialize,
    dependencies: ContentKnowledgeRpcDependencies
  ) =>
  <ReplyError>(delivery: ContentKnowledgeRpcDelivery<ReplyError>) =>
    Effect.try({
      try: (): unknown => JSON.parse(delivery.payload),
      catch: () => rejection("INVALID_REQUEST"),
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () => rawReject(delivery, "INVALID_REQUEST"),
        onSuccess: (request) => {
          const reject = (code: ContentKnowledgeRejection["code"]) =>
            correlatedReply(delivery, request, rejection(code), dependencies)
          if (request.actor._tag !== "User") return reject("UNAUTHENTICATED")
          const requiredProducer =
            delivery.subject === subjects.content.materializeArticles
              ? "episode-production"
              : "gateway"
          if (request.producer !== requiredProducer)
            return reject("INVALID_REQUEST")
          return parseOwner(request.actor.userId).pipe(
            Effect.mapError(() => rejection("INVALID_REQUEST")),
            Effect.flatMap((ownerId): Effect.Effect<unknown, unknown> => {
              if (delivery.subject === subjects.content.addSubscription) {
                return parseAddFeedSubscriptionRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.flatMap((input) => {
                    const identity = dependencies.newSubscriptionIdentity()
                    return Effect.all([
                      parse(FeedUrlSchema)(input.feedUrl),
                      parse(CreatedAtSchema)(dependencies.now()),
                    ]).pipe(
                      Effect.flatMap(([feedUrl, createdAt]) =>
                        subscriptions.add({
                          ...identity,
                          ownerId,
                          feedUrl,
                          enabled: true,
                          createdAt,
                        })
                      ),
                      Effect.map((result) =>
                        deepFreeze({
                          _tag: "Added" as const,
                          subscription: wireSubscription(result.subscription),
                        })
                      )
                    )
                  })
                )
              }
              if (delivery.subject === subjects.content.listSubscriptions) {
                return parseListFeedSubscriptionsRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.andThen(subscriptions.list(ownerId)),
                  Effect.map((items) =>
                    deepFreeze({
                      _tag: "Listed" as const,
                      subscriptions: items.map(wireSubscription),
                    })
                  )
                )
              }
              if (delivery.subject === subjects.content.deleteSubscription) {
                return parseDeleteFeedSubscriptionRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.flatMap((input) =>
                    parse(SubscriptionIdSchema)(input.subscriptionId).pipe(
                      Effect.mapError(() => rejection("INVALID_REQUEST")),
                      Effect.flatMap((subscriptionId) =>
                        subscriptions.remove(ownerId, subscriptionId)
                      )
                    )
                  ),
                  Effect.map((result) =>
                    deepFreeze({
                      _tag:
                        result._tag === "Deleted"
                          ? ("Deleted" as const)
                          : ("NotFound" as const),
                    })
                  )
                )
              }
              if (delivery.subject === subjects.content.updateSubscription) {
                return parseUpdateFeedSubscriptionRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.flatMap((input) =>
                    parse(SubscriptionIdSchema)(input.subscriptionId).pipe(
                      Effect.mapError(() => rejection("INVALID_REQUEST")),
                      Effect.flatMap((subscriptionId) =>
                        subscriptions.setEnabled(
                          ownerId,
                          subscriptionId,
                          input.enabled
                        )
                      )
                    )
                  ),
                  Effect.map((result) =>
                    result._tag === "NotFound"
                      ? deepFreeze({ _tag: "NotFound" as const })
                      : deepFreeze({
                          _tag: "Updated" as const,
                          subscription: wireSubscription(result.subscription),
                          enabled: result.enabled,
                        })
                  )
                )
              }
              if (delivery.subject === subjects.content.listFeedCatalog) {
                return parseListFeedCatalogRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.flatMap(({ q }) =>
                    subscriptions.listCatalog(ownerId, q)
                  ),
                  Effect.map((feeds) =>
                    deepFreeze({ _tag: "Catalog" as const, feeds })
                  )
                )
              }
              if (delivery.subject === subjects.content.materializeArticles) {
                return parseMaterializeArticlesRequest(request.payload).pipe(
                  Effect.mapError(() => rejection("INVALID_REQUEST")),
                  Effect.flatMap((input) =>
                    input.selection._tag === "Automatic"
                      ? materialize({
                          ownerId,
                          selection: deepFreeze({ _tag: "Automatic" }),
                        })
                      : Effect.forEach(
                          input.selection.articleIds,
                          (articleId) => parse(ArticleIdSchema)(articleId),
                          { concurrency: 1 }
                        ).pipe(
                          Effect.mapError(() => rejection("INVALID_REQUEST")),
                          Effect.flatMap((articleIds) =>
                            materialize({
                              ownerId,
                              selection: deepFreeze({
                                _tag: "Selected",
                                articleIds,
                              }),
                            })
                          )
                        )
                  ),
                  Effect.map((result) => deepFreeze(result))
                )
              }
              return Effect.fail(rejection("INVALID_REQUEST"))
            }),
            Effect.matchEffect({
              onFailure: (failure) => reject(failureCode(failure)),
              onSuccess: (reply) =>
                correlatedReply(delivery, request, reply, dependencies),
            })
          )
        },
      })
    )
