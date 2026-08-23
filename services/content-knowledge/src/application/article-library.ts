import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { MarkdownObjectReader } from "./ports/article-catalog.js"
import {
  ArchiveCommandSchema,
  type ArchiveRequestId,
  type ArticleId,
  type CapturedAt,
  type MediaType,
  type ObjectKey,
  type Sha256,
  type SnapshotId,
} from "../domain/article.js"
import {
  ArticleCursorSchema,
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
} from "./ports/archive.js"

const uniqueFeedIds = Schema.makeFilter<readonly FeedId[]>((feedIds) =>
  new Set(feedIds).size === feedIds.length ? true : "feed IDs must be unique"
)
// oxlint-disable-next-line eslint/no-control-regex -- SQLite FTS cannot accept NUL, so reject controls at the RPC boundary.
const searchableTextPattern = new RegExp("^[^\\u0000-\\u001f\\u007f]*$")

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
      Schema.isMaxLength(200),
      Schema.isPattern(searchableTextPattern)
    )
  ),
  order: Schema.Literals(["Newest", "Oldest"]),
  /** 直前ページ末尾の位置。未指定なら先頭ページ。 */
  cursor: Schema.optional(ArticleCursorSchema),
})
export type ArticleListQuery = Schema.Schema.Type<typeof ArticleListQuerySchema>
export const parseArticleListQuery = parse(ArticleListQuerySchema)

/** ページングを持たない操作 (facets・一括更新) が受け取れる絞り込みだけの形。 */
export type ArticleFilterQuery = Omit<
  ArticleListQuery,
  "limit" | "order" | "cursor"
>

export type ArticleListPage = DeepReadonly<{
  readonly items: readonly ArticleView[]
  /** 次ページが無ければ`null`。`items.length === limit`でも次が無ければ`null`になる。 */
  readonly nextCursor: string | null
}>

export type ArticleFacets = DeepReadonly<{
  readonly states: {
    readonly all: number
    readonly unread: number
    readonly saved: number
    readonly later: number
  }
  readonly feeds: readonly {
    readonly feedId: FeedId
    readonly feedUrl: string
    readonly count: number
  }[]
}>

export type ArticleLibraryError = DeepReadonly<{
  readonly _tag: "ArticleLibraryFailed"
  readonly operation:
    | "List"
    | "Find"
    | "ReplayAccess"
    | "Patch"
    | "BulkPatch"
    | "Facets"
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

export type ReplayObjectLookup = DeepReadonly<
  | {
      readonly _tag: "Found"
      readonly object: {
        readonly key: ObjectKey
        readonly mediaType: MediaType
        readonly byteLength: number
        readonly sha256: Sha256
      }
    }
  | { readonly _tag: "NotFound" }
>

export type ArticleLibraryRepository = DeepReadonly<{
  readonly list: (
    ownerId: OwnerId,
    query: ArticleListQuery
  ) => Effect.Effect<ArticleListPage, ArticleLibraryError>
  readonly find: (
    ownerId: OwnerId,
    articleId: ArticleId
  ) => Effect.Effect<ArticleLookup, ArticleLibraryError>
  readonly findMarkdown: (
    ownerId: OwnerId,
    articleId: ArticleId
  ) => Effect.Effect<ArticleObjectLookup, ArticleLibraryError>
  readonly findReplayObject: (
    ownerId: OwnerId,
    snapshotId: SnapshotId,
    object: Readonly<
      | { readonly kind: "Replay" }
      | { readonly kind: "Asset"; readonly assetName: string }
    >
  ) => Effect.Effect<ReplayObjectLookup, ArticleLibraryError>
  readonly patch: (
    ownerId: OwnerId,
    articleId: ArticleId,
    patch: ArticleStatePatch,
    changedAt: CapturedAt
  ) => Effect.Effect<ArticleLookup, ArticleLibraryError>
  readonly bulkPatch: (
    ownerId: OwnerId,
    query: ArticleFilterQuery,
    patch: ArticleStatePatch,
    changedAt: CapturedAt
  ) => Effect.Effect<number, ArticleLibraryError>
  readonly facets: (
    ownerId: OwnerId,
    query: Omit<ArticleFilterQuery, "state">
  ) => Effect.Effect<ArticleFacets, ArticleLibraryError>
}>

export type OwnerArticleMarkdownResult = DeepReadonly<
  | { readonly _tag: "Found"; readonly markdown: string }
  | { readonly _tag: "NotFound" }
>

export type ReplayAccessSigningFailure = DeepReadonly<{
  readonly _tag: "ReplayAccessSigningFailure"
}>

export type ReplayAccessSigner = DeepReadonly<{
  readonly issue: (input: {
    readonly objectKey: ObjectKey
    readonly mediaType: MediaType
    readonly expiresAtEpochMillis: number
  }) => Effect.Effect<string, ReplayAccessSigningFailure>
}>

export type OwnerReplayAccessResult = DeepReadonly<
  | {
      readonly _tag: "Found"
      readonly url: string
      readonly mediaType: MediaType
      readonly byteLength: number
      readonly sha256: Sha256
    }
  | { readonly _tag: "NotFound" }
>

/** Authorization and exact immutable metadata lookup always precede signing. */
export const createOwnerReplayAccess =
  (ports: {
    readonly articles: Pick<ArticleLibraryRepository, "findReplayObject">
    readonly signer: ReplayAccessSigner
    readonly nowEpochMillis: () => number
  }) =>
  (
    ownerId: OwnerId,
    snapshotId: SnapshotId,
    object: Readonly<
      | { readonly kind: "Replay" }
      | { readonly kind: "Asset"; readonly assetName: string }
    >
  ) =>
    ports.articles.findReplayObject(ownerId, snapshotId, object).pipe(
      Effect.flatMap((lookup) => {
        if (lookup._tag === "NotFound") {
          return Effect.succeed<OwnerReplayAccessResult>(
            deepFreeze({ _tag: "NotFound" })
          )
        }
        return ports.signer
          .issue({
            objectKey: lookup.object.key,
            mediaType: lookup.object.mediaType,
            expiresAtEpochMillis: ports.nowEpochMillis() + 60_000,
          })
          .pipe(
            Effect.map((url): OwnerReplayAccessResult =>
              deepFreeze({
                _tag: "Found",
                url,
                mediaType: lookup.object.mediaType,
                byteLength: lookup.object.byteLength,
                sha256: lookup.object.sha256,
              })
            )
          )
      })
    )

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
    readonly deriveArchiveRequestId: (input: {
      readonly articleId: ArticleId
      readonly messageId: ArchiveMessageContext["messageId"]
    }) => ArchiveRequestId
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
          archiveRequestId: ports.deriveArchiveRequestId({
            articleId: input.articleId,
            messageId: input.context.messageId,
          }),
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
