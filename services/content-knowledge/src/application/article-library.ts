import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { MarkdownObjectReader } from "./article-catalog-ports.js"
import {
  ArchiveCommandSchema,
  type ArchiveRequestId,
  type ArticleId,
  type CapturedAt,
  type ObjectKey,
} from "../domain/article.js"
import {
  ArticleStatePatchSchema,
  type ArticleStatePatch,
  type ArticleView,
} from "../domain/article-library.js"
import {
  FeedIdSchema,
  type FeedId,
  type OwnerId,
} from "../domain/subscription.js"
import type {
  ArchiveArticleInvocation,
  ArchiveArticleResult,
} from "./archive-article.js"
import type {
  ArchiveMessageContext,
  ArchiveStoreError,
  CaptureError,
} from "./ports.js"

const uniqueFeedIds = Schema.makeFilter<readonly FeedId[]>((feedIds) =>
  new Set(feedIds).size === feedIds.length ? true : "feed IDs must be unique"
)

export const parseArticleStatePatch = parse(ArticleStatePatchSchema)

export const ArticleListQuerySchema = Schema.Struct({
  limit: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100)
  ),
  state: Schema.Literals(["All", "Unread", "Saved", "Later"]),
  includeHidden: Schema.Boolean,
  feedIds: Schema.Array(FeedIdSchema).check(
    Schema.isMaxLength(50),
    uniqueFeedIds
  ),
  q: Schema.optional(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    )
  ),
  order: Schema.Literals(["Newest", "Oldest"]),
})
export type ArticleListQuery = Schema.Schema.Type<typeof ArticleListQuerySchema>
export const parseArticleListQuery = parse(ArticleListQuerySchema)

export type ArticleFacets = DeepReadonly<{
  readonly states: {
    readonly all: number
    readonly unread: number
    readonly saved: number
    readonly later: number
  }
  readonly feeds: readonly {
    readonly feedId: FeedId
    readonly count: number
  }[]
}>

export type ArticleLibraryError = DeepReadonly<{
  readonly _tag: "ArticleLibraryFailed"
  readonly operation: "List" | "Find" | "Patch" | "BulkPatch" | "Facets"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type ArticleLookup = DeepReadonly<
  | { readonly _tag: "Found"; readonly article: ArticleView }
  | { readonly _tag: "NotFound" }
>

export type ArticleObjectLookup = DeepReadonly<
  | { readonly _tag: "Found"; readonly key: ObjectKey }
  | { readonly _tag: "NotFound" }
>

export type ArticleLibraryRepository = DeepReadonly<{
  readonly list: (
    ownerId: OwnerId,
    query: ArticleListQuery
  ) => Effect.Effect<readonly ArticleView[], ArticleLibraryError>
  readonly find: (
    ownerId: OwnerId,
    articleId: ArticleId
  ) => Effect.Effect<ArticleLookup, ArticleLibraryError>
  readonly findMarkdown: (
    ownerId: OwnerId,
    articleId: ArticleId
  ) => Effect.Effect<ArticleObjectLookup, ArticleLibraryError>
  readonly patch: (
    ownerId: OwnerId,
    articleId: ArticleId,
    patch: ArticleStatePatch,
    changedAt: CapturedAt
  ) => Effect.Effect<ArticleLookup, ArticleLibraryError>
  readonly bulkPatch: (
    ownerId: OwnerId,
    query: Omit<ArticleListQuery, "limit" | "order">,
    patch: ArticleStatePatch,
    changedAt: CapturedAt
  ) => Effect.Effect<number, ArticleLibraryError>
  readonly facets: (
    ownerId: OwnerId,
    query: Omit<ArticleListQuery, "limit" | "order" | "state">
  ) => Effect.Effect<ArticleFacets, ArticleLibraryError>
}>

export type OwnerArticleMarkdownResult = DeepReadonly<
  | { readonly _tag: "Found"; readonly markdown: string }
  | { readonly _tag: "NotFound" }
>

export const readOwnerArticleMarkdown =
  (ports: {
    readonly articles: Pick<ArticleLibraryRepository, "findMarkdown">
    readonly objects: MarkdownObjectReader
  }) =>
  (ownerId: OwnerId, articleId: ArticleId) =>
    ports.articles
      .findMarkdown(ownerId, articleId)
      .pipe(
        Effect.flatMap((lookup) =>
          lookup._tag === "NotFound"
            ? Effect.succeed<OwnerArticleMarkdownResult>(
                deepFreeze({ _tag: "NotFound" })
              )
            : ports.objects
                .read(lookup.key)
                .pipe(
                  Effect.map((markdown): OwnerArticleMarkdownResult =>
                    deepFreeze({ _tag: "Found", markdown })
                  )
                )
        )
      )

export type TriggerOwnerArticleArchiveResult = DeepReadonly<
  { readonly _tag: "NotFound" } | ArchiveArticleResult
>

/** Owner lookup precedes capture, so article IDs cannot cross tenant boundaries. */
export const triggerOwnerArticleArchive =
  (ports: {
    readonly articles: Pick<ArticleLibraryRepository, "find">
    readonly deriveArchiveRequestId: (articleId: ArticleId) => ArchiveRequestId
    readonly archive: (
      invocation: ArchiveArticleInvocation
    ) => Effect.Effect<ArchiveArticleResult, ArchiveStoreError | CaptureError>
  }) =>
  (input: {
    readonly ownerId: OwnerId
    readonly articleId: ArticleId
    readonly context: ArchiveMessageContext
  }): Effect.Effect<
    TriggerOwnerArticleArchiveResult,
    ArticleLibraryError | ArchiveStoreError | CaptureError
  > =>
    ports.articles.find(input.ownerId, input.articleId).pipe(
      Effect.flatMap((lookup) => {
        if (lookup._tag === "NotFound") {
          return Effect.succeed<TriggerOwnerArticleArchiveResult>(
            deepFreeze({ _tag: "NotFound" })
          )
        }
        return parse(ArchiveCommandSchema)({
          archiveRequestId: ports.deriveArchiveRequestId(input.articleId),
          articleId: lookup.article.articleId,
          sourceUrl: lookup.article.sourceUrl,
          title: lookup.article.title,
        }).pipe(
          Effect.orDie,
          Effect.flatMap((command) =>
            ports.archive(
              deepFreeze({ command, context: deepFreeze(input.context) })
            )
          )
        )
      })
    )
