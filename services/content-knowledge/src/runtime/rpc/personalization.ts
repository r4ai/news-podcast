import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  ContentPersonalizationReplySchema,
  MessageEnvelopeSchema,
  parseContentPersonalizationRequest,
  parseMessageEnvelope,
  subjects,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { ArticleIdSchema } from "../../domain/article.js"
import { TagIdSchema, TagNameSchema } from "../../domain/content-taxonomy.js"
import { parseInterestProfile } from "../../domain/interest-profile.js"
import { OwnerIdSchema } from "../../domain/subscription.js"
import type { createContentTaxonomy } from "../../application/content-taxonomy.js"
import type { createEnrichmentOperations } from "../../application/enrichment.js"
import type { createInterestProfileOperations } from "../../application/interest-profile.js"

type Delivery<E = never> = Readonly<{
  readonly subject: string
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, E>
}>
type Operations = Readonly<{
  readonly taxonomy: ReturnType<typeof createContentTaxonomy>
  readonly interestProfiles: ReturnType<typeof createInterestProfileOperations>
  readonly enrichment: ReturnType<typeof createEnrichmentOperations>
}>
type Dependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
}>
const rejected = (
  code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "STORAGE_FAILURE"
) => deepFreeze({ _tag: "Rejected" as const, code })

const correlated = <E>(
  delivery: Delivery<E>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: Dependencies
) =>
  parse(ContentPersonalizationReplySchema)(payload).pipe(
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

/** Owner-scoped personalization RPC; no operation accepts an owner field. */
export const makePersonalizationRpcHandler =
  (operations: Operations, dependencies: Dependencies) =>
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
            delivery.subject !== subjects.content.personalization ||
            request.producer !== "gateway"
          )
            return reply(rejected("INVALID_REQUEST"))
          if (request.actor._tag !== "User")
            return reply(rejected("UNAUTHENTICATED"))
          return Effect.all([
            parse(OwnerIdSchema)(request.actor.userId),
            parseContentPersonalizationRequest(request.payload).pipe(
              Effect.mapError(() => ({ _tag: "InvalidRequest" as const }))
            ),
          ]).pipe(
            Effect.flatMap(
              ([ownerId, command]): Effect.Effect<unknown, unknown, never> => {
                switch (command.operation) {
                  case "GetInterestProfile":
                    return operations.interestProfiles.get(ownerId).pipe(
                      Effect.map((interestProfile) => ({
                        _tag: "InterestProfile" as const,
                        interestProfile,
                      }))
                    )
                  case "UpdateInterestProfile":
                    return parseInterestProfile(command.interestProfile).pipe(
                      Effect.flatMap((profile) =>
                        operations.interestProfiles.update(ownerId, profile)
                      ),
                      Effect.map((interestProfile) => ({
                        _tag: "InterestProfile" as const,
                        interestProfile,
                      }))
                    )
                  case "ListTags":
                    return operations.taxonomy
                      .listTags(ownerId)
                      .pipe(
                        Effect.map((tags) => ({ _tag: "Tags" as const, tags }))
                      )
                  case "CreateTag":
                    return parse(TagNameSchema)(command.name).pipe(
                      Effect.flatMap((name) =>
                        operations.taxonomy.createTag(ownerId, name)
                      ),
                      Effect.map((tag) => ({ _tag: "Tag" as const, tag }))
                    )
                  case "DeleteTag":
                    return parse(TagIdSchema)(command.tagId).pipe(
                      Effect.flatMap((tagId) =>
                        operations.taxonomy.deleteTag(ownerId, tagId)
                      ),
                      Effect.map((deleted) =>
                        deleted
                          ? { _tag: "Deleted" as const }
                          : { _tag: "NotFound" as const }
                      )
                    )
                  case "ListTagSuggestions":
                    return operations.taxonomy.listSuggestions(ownerId).pipe(
                      Effect.map((suggestions) => ({
                        _tag: "Suggestions" as const,
                        suggestions,
                      }))
                    )
                  case "PromoteTagSuggestion":
                    return parse(TagNameSchema)(command.name).pipe(
                      Effect.flatMap((name) =>
                        operations.taxonomy.promoteSuggestion(ownerId, name)
                      ),
                      Effect.map((result) =>
                        result._tag === "Promoted"
                          ? { _tag: "Tag" as const, tag: result.tag }
                          : { _tag: "NotFound" as const }
                      )
                    )
                  case "SetArticleTags":
                    return Effect.all([
                      parse(ArticleIdSchema)(command.articleId),
                      Effect.forEach(command.tagIds, (id) =>
                        parse(TagIdSchema)(id)
                      ),
                    ]).pipe(
                      Effect.flatMap(([articleId, tagIds]) =>
                        operations.taxonomy.setArticleTags(
                          ownerId,
                          articleId,
                          tagIds
                        )
                      ),
                      Effect.map((result) =>
                        result._tag === "Updated"
                          ? { _tag: "ArticleTags" as const, tags: result.tags }
                          : result._tag === "ArticleNotFound"
                            ? { _tag: "NotFound" as const }
                            : {
                                _tag: "Conflict" as const,
                                code: "UNKNOWN_TAGS" as const,
                              }
                      )
                    )
                  case "ListArticleTags":
                    return parse(ArticleIdSchema)(command.articleId).pipe(
                      Effect.flatMap((articleId) =>
                        operations.taxonomy.listArticleTags(ownerId, articleId)
                      ),
                      Effect.map((tags) => ({
                        _tag: "ArticleTags" as const,
                        tags,
                      }))
                    )
                  case "GetEnrichmentQueue":
                    return operations.enrichment.status(ownerId).pipe(
                      Effect.map((queue) => ({
                        _tag: "EnrichmentQueue" as const,
                        queue,
                      }))
                    )
                  case "ReprocessEnrichment":
                    return operations.enrichment.enqueueReprocess(ownerId).pipe(
                      Effect.map((count) => ({
                        _tag: "Enqueued" as const,
                        count,
                      }))
                    )
                  case "ResetDailyEnrichment":
                    return operations.enrichment
                      .resetDaily(ownerId)
                      .pipe(Effect.as({ _tag: "Reset" as const }))
                  case "EnrichArticle":
                    return parse(ArticleIdSchema)(command.articleId).pipe(
                      Effect.flatMap((articleId) =>
                        operations.enrichment.enqueueOne(ownerId, articleId)
                      ),
                      Effect.map((result) =>
                        result._tag === "NotFound"
                          ? { _tag: "NotFound" as const }
                          : {
                              _tag: "Enqueued" as const,
                              count: result._tag === "Enqueued" ? 1 : 0,
                            }
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
                      failure._tag === "InvalidRequest"
                      ? "INVALID_REQUEST"
                      : "STORAGE_FAILURE"
                  )
                ),
              onSuccess: reply,
            })
          )
        },
      })
    )
