import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArticleId, CapturedAt } from "../domain/article.js"
import type {
  ArticleTag,
  Tag,
  TagId,
  TagName,
  TagSuggestion,
} from "../domain/content-taxonomy.js"
import type { OwnerId } from "../domain/subscription.js"

export type ContentTaxonomyError = DeepReadonly<{
  readonly _tag: "ContentTaxonomyFailed"
  readonly operation:
    | "ListTags"
    | "CreateTag"
    | "DeleteTag"
    | "ListSuggestions"
    | "PromoteSuggestion"
    | "SetArticleTags"
    | "ListArticleTags"
    | "ApplyAiTags"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type SetArticleTagsResult = DeepReadonly<
  | { readonly _tag: "Updated"; readonly tags: readonly ArticleTag[] }
  | { readonly _tag: "ArticleNotFound" }
  | { readonly _tag: "UnknownTags"; readonly tagIds: readonly TagId[] }
>

export type PromoteSuggestionResult = DeepReadonly<
  | { readonly _tag: "Promoted"; readonly tag: Tag }
  | { readonly _tag: "NotFound" }
>

export type ContentTaxonomyRepository = DeepReadonly<{
  readonly listTags: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly Tag[], ContentTaxonomyError>
  readonly createTag: (
    ownerId: OwnerId,
    tag: Tag
  ) => Effect.Effect<Tag, ContentTaxonomyError>
  readonly deleteTag: (
    ownerId: OwnerId,
    tagId: TagId
  ) => Effect.Effect<boolean, ContentTaxonomyError>
  readonly listSuggestions: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly TagSuggestion[], ContentTaxonomyError>
  readonly promoteSuggestion: (
    ownerId: OwnerId,
    name: TagName,
    tag: Tag
  ) => Effect.Effect<PromoteSuggestionResult, ContentTaxonomyError>
  readonly setManualArticleTags: (
    ownerId: OwnerId,
    articleId: ArticleId,
    tagIds: readonly TagId[],
    changedAt: CapturedAt
  ) => Effect.Effect<SetArticleTagsResult, ContentTaxonomyError>
  readonly listArticleTags: (
    ownerId: OwnerId,
    articleId: ArticleId
  ) => Effect.Effect<readonly ArticleTag[], ContentTaxonomyError>
  readonly vocabulary: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly TagName[], ContentTaxonomyError>
  readonly applyAiTags: (
    ownerId: OwnerId,
    articleId: ArticleId,
    tags: readonly { readonly name: TagName; readonly confidence: number }[],
    suggestions: readonly TagName[],
    changedAt: CapturedAt
  ) => Effect.Effect<void, ContentTaxonomyError>
}>

export const createContentTaxonomy = (input: {
  readonly repository: ContentTaxonomyRepository
  readonly newTagId: () => TagId
  readonly now: () => CapturedAt
}) =>
  deepFreeze({
    listTags: Effect.fn("contentKnowledge.taxonomy.listTags")(function* (
      ownerId: OwnerId
    ) {
      return yield* input.repository.listTags(ownerId)
    }),
    createTag: Effect.fn("contentKnowledge.taxonomy.createTag")(function* (
      ownerId: OwnerId,
      name: TagName
    ) {
      return yield* input.repository.createTag(
        ownerId,
        deepFreeze({ tagId: input.newTagId(), name, createdAt: input.now() })
      )
    }),
    deleteTag: Effect.fn("contentKnowledge.taxonomy.deleteTag")(function* (
      ownerId: OwnerId,
      tagId: TagId
    ) {
      return yield* input.repository.deleteTag(ownerId, tagId)
    }),
    listSuggestions: Effect.fn("contentKnowledge.taxonomy.listSuggestions")(
      function* (ownerId: OwnerId) {
        return yield* input.repository.listSuggestions(ownerId)
      }
    ),
    promoteSuggestion: Effect.fn("contentKnowledge.taxonomy.promoteSuggestion")(
      function* (ownerId: OwnerId, name: TagName) {
        return yield* input.repository.promoteSuggestion(
          ownerId,
          name,
          deepFreeze({ tagId: input.newTagId(), name, createdAt: input.now() })
        )
      }
    ),
    setArticleTags: Effect.fn("contentKnowledge.taxonomy.setArticleTags")(
      function* (
        ownerId: OwnerId,
        articleId: ArticleId,
        tagIds: readonly TagId[]
      ) {
        return yield* input.repository.setManualArticleTags(
          ownerId,
          articleId,
          deepFreeze([...new Set(tagIds)]),
          input.now()
        )
      }
    ),
    listArticleTags: Effect.fn("contentKnowledge.taxonomy.listArticleTags")(
      function* (ownerId: OwnerId, articleId: ArticleId) {
        return yield* input.repository.listArticleTags(ownerId, articleId)
      }
    ),
  })
