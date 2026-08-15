import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  ArticleListQuerySchema,
  parseArticleStatePatch,
  readOwnerArticleMarkdown,
  triggerOwnerArticleArchive,
  type ArticleLibraryRepository,
} from "../../application/article-library.js"
import type { MarkdownObjectReader } from "../../application/ports/article-catalog.js"
import {
  ArticleIdSchema,
  type ArchiveRequestId,
  type CapturedAt,
} from "../../domain/article.js"
import { ArticleStatePatchSchema } from "../../domain/article-library.js"
import { FeedIdSchema, OwnerIdSchema } from "../../domain/subscription.js"
import type {
  ArchiveArticleInvocation,
  ArchiveArticleResult,
} from "../../application/archive-article.js"
import type {
  ArchiveMessageContext,
  ArchiveStoreError,
  CaptureError,
} from "../../application/ports/archive.js"

const ArticleIdentitySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  articleId: ArticleIdSchema,
})
const ListInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: ArticleListQuerySchema,
})
const PatchInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  articleId: ArticleIdSchema,
  patch: ArticleStatePatchSchema,
})
const ArticleFilterFields = {
  includeHidden: Schema.Boolean,
  feedIds: Schema.Array(FeedIdSchema).check(
    Schema.isMaxLength(50),
    Schema.makeFilter((feedIds) =>
      new Set(feedIds).size === feedIds.length
        ? true
        : "feed IDs must be unique"
    )
  ),
  q: Schema.optional(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    )
  ),
} as const
const BulkInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: Schema.Struct({
    state: Schema.Literals(["All", "Unread", "Saved", "Later"]),
    ...ArticleFilterFields,
  }),
  patch: ArticleStatePatchSchema,
})
const FacetsInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  query: Schema.Struct(ArticleFilterFields),
})

export type ArticleLibraryRequestError = DeepReadonly<{
  readonly _tag: "ArticleLibraryRequestRejected"
  readonly code: "InvalidRequest"
}>

const invalidRequest = (): ArticleLibraryRequestError =>
  deepFreeze({
    _tag: "ArticleLibraryRequestRejected",
    code: "InvalidRequest",
  })

const strict =
  <S extends Schema.Top>(schema: S) =>
  (input: unknown) =>
    parse(schema)(input).pipe(Effect.mapError(invalidRequest))

export type ArticleLibraryHandlerDependencies = Readonly<{
  readonly articles: ArticleLibraryRepository
  readonly objects: MarkdownObjectReader
  readonly now: () => CapturedAt
  readonly deriveArchiveRequestId: (
    articleId: Schema.Schema.Type<typeof ArticleIdSchema>
  ) => ArchiveRequestId
  readonly archive: (
    invocation: ArchiveArticleInvocation
  ) => Effect.Effect<ArchiveArticleResult, ArchiveStoreError | CaptureError>
}>

/** Transport-neutral handlers; authentication must supply the owner, parsing still fails closed. */
export const makeArticleLibraryHandler = (
  dependencies: ArticleLibraryHandlerDependencies
) => {
  const markdown = readOwnerArticleMarkdown({
    articles: dependencies.articles,
    objects: dependencies.objects,
  })
  const triggerArchive = triggerOwnerArticleArchive({
    articles: dependencies.articles,
    deriveArchiveRequestId: dependencies.deriveArchiveRequestId,
    archive: dependencies.archive,
  })

  return deepFreeze({
    list: (input: unknown) =>
      strict(ListInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query }) =>
          dependencies.articles.list(ownerId, query)
        )
      ),
    find: (input: unknown) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) =>
          dependencies.articles.find(ownerId, articleId)
        )
      ),
    markdown: (input: unknown) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) => markdown(ownerId, articleId))
      ),
    patch: (input: unknown) =>
      strict(PatchInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId, patch }) =>
          parseArticleStatePatch(patch).pipe(
            Effect.mapError(invalidRequest),
            Effect.flatMap((trusted) =>
              dependencies.articles.patch(
                ownerId,
                articleId,
                trusted,
                dependencies.now()
              )
            )
          )
        )
      ),
    bulkPatch: (input: unknown) =>
      strict(BulkInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query, patch }) =>
          dependencies.articles.bulkPatch(
            ownerId,
            query,
            patch,
            dependencies.now()
          )
        )
      ),
    facets: (input: unknown) =>
      strict(FacetsInputSchema)(input).pipe(
        Effect.flatMap(({ ownerId, query }) =>
          dependencies.articles.facets(ownerId, query)
        )
      ),
    archive: (input: unknown, context: ArchiveMessageContext) =>
      strict(ArticleIdentitySchema)(input).pipe(
        Effect.flatMap(({ ownerId, articleId }) =>
          triggerArchive({ ownerId, articleId, context })
        )
      ),
  })
}
