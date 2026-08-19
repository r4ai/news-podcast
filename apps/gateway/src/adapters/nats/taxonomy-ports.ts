import { parse } from "@news-podcast/kernel"
import {
  parseContentPersonalizationReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  TagPageSchema,
  TagSchema,
  TagSuggestionPageSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../application/ports.js"
import { normalizeProblem, resourceNotFound, unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 利用者が持つタグ語彙と、AIが提示するタグ候補の昇格。
 */

type TaxonomyPorts = Pick<
  GatewayPorts,
  | "listTags"
  | "createTag"
  | "deleteTag"
  | "listTagSuggestions"
  | "promoteTagSuggestion"
>

type Headers = Parameters<GatewayPorts["listTags"]>[0]
type PersonalizationReply = Effect.Success<
  ReturnType<typeof parseContentPersonalizationReply>
>
type Tag = Schema.Schema.Type<typeof TagSchema>
type TagPage = Schema.Schema.Type<typeof TagPageSchema>
type TagSuggestionPage = Schema.Schema.Type<typeof TagSuggestionPageSchema>
type UnavailableProblem = ReturnType<typeof unavailable>
type NotFoundProblem = ReturnType<typeof resourceNotFound>

const toPublicTag = (tag: {
  readonly tagId: string
  readonly name: string
  readonly createdAt: string
}) => ({ id: tag.tagId, name: tag.name, createdAt: tag.createdAt })

export const makeTaxonomyPorts = (transport: Transport): TaxonomyPorts => {
  const personalizationRpc = (headers: Headers, payload: unknown) =>
    transport.ownerRpc(
      headers,
      subjects.content.personalization,
      "content-knowledge",
      payload,
      parseContentPersonalizationReply
    )

  return {
    listTags: (headers) =>
      personalizationRpc(headers, { operation: "ListTags" }).pipe(
        Effect.flatMap((reply): Effect.Effect<TagPage, UnavailableProblem> =>
          reply._tag === "Tags"
            ? parse(TagPageSchema)({
                items: reply.tags.map(toPublicTag),
                page: { hasMore: false },
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    createTag: ({ headers, payload }) =>
      personalizationRpc(headers, {
        operation: "CreateTag",
        name: payload.name,
      }).pipe(
        Effect.flatMap((reply): Effect.Effect<Tag, UnavailableProblem> =>
          reply._tag === "Tag"
            ? parse(TagSchema)(toPublicTag(reply.tag)).pipe(
                Effect.mapError(unavailable)
              )
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    deleteTag: ({ headers, tagId }) =>
      personalizationRpc(headers, { operation: "DeleteTag", tagId }).pipe(
        Effect.flatMap(
          (
            reply: PersonalizationReply
          ): Effect.Effect<void, NotFoundProblem | UnavailableProblem> =>
            reply._tag === "Deleted"
              ? Effect.void
              : reply._tag === "NotFound"
                ? Effect.fail(resourceNotFound())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    listTagSuggestions: (headers) =>
      personalizationRpc(headers, { operation: "ListTagSuggestions" }).pipe(
        Effect.flatMap(
          (reply): Effect.Effect<TagSuggestionPage, UnavailableProblem> =>
            reply._tag === "Suggestions"
              ? parse(TagSuggestionPageSchema)({
                  items: reply.suggestions,
                  page: { hasMore: false },
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    promoteTagSuggestion: ({ headers, payload }) =>
      personalizationRpc(headers, {
        operation: "PromoteTagSuggestion",
        name: payload.name,
      }).pipe(
        Effect.flatMap(
          (
            reply: PersonalizationReply
          ): Effect.Effect<Tag, NotFoundProblem | UnavailableProblem> =>
            reply._tag === "Tag"
              ? parse(TagSchema)(toPublicTag(reply.tag)).pipe(
                  Effect.mapError(unavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(resourceNotFound())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
