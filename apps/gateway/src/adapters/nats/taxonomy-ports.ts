import { parse } from "@news-podcast/kernel"
import {
  parseContentPersonalizationReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"

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

const toPublicTag = (tag: {
  readonly tagId: string
  readonly name: string
  readonly createdAt: string
}) => ({ id: tag.tagId, name: tag.name, createdAt: tag.createdAt })

export const makeTaxonomyPorts = (transport: Transport): TaxonomyPorts => {
  const personalizationRpc = (headers: Headers, payload: unknown) =>
    transport
      .ownerRpc(
        headers,
        subjects.content.personalization,
        "content-knowledge",
        payload,
        parseContentPersonalizationReply
      )
      .pipe(Effect.mapError(normalizeProblem))

  return {
    listTags: (headers) =>
      personalizationRpc(headers, { operation: "ListTags" }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Tags"
            ? parse(TagPageSchema)({
                items: reply.tags.map(toPublicTag),
                page: { hasMore: false },
              })
            : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    createTag: ({ headers, payload }) =>
      personalizationRpc(headers, {
        operation: "CreateTag",
        name: payload.name,
      }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Tag"
            ? parse(TagSchema)(toPublicTag(reply.tag))
            : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    deleteTag: ({ headers, tagId }) =>
      personalizationRpc(headers, { operation: "DeleteTag", tagId }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Deleted"
            ? Effect.void
            : reply._tag === "NotFound"
              ? Effect.fail(resourceNotFound())
              : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    listTagSuggestions: (headers) =>
      personalizationRpc(headers, { operation: "ListTagSuggestions" }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Suggestions"
            ? parse(TagSuggestionPageSchema)({
                items: reply.suggestions,
                page: { hasMore: false },
              })
            : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
    promoteTagSuggestion: ({ headers, payload }) =>
      personalizationRpc(headers, {
        operation: "PromoteTagSuggestion",
        name: payload.name,
      }).pipe(
        Effect.flatMap((reply) =>
          (reply._tag === "Tag"
            ? parse(TagSchema)(toPublicTag(reply.tag))
            : reply._tag === "NotFound"
              ? Effect.fail(resourceNotFound())
              : Effect.fail(unavailable())
          ).pipe(Effect.mapError(normalizeProblem))
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
