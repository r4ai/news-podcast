import { parse } from "@news-podcast/kernel"
import {
  type ArticleLibraryReply,
  ContentArticleViewSchema,
  parseArticleLibraryReply,
  parseContentPersonalizationReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  ArticleArchiveResultSchema,
  ArticleFacetsSchema,
  ArticleMarkdownSchema,
  ArticlePageSchema,
  ArticleSchema,
  ArticleTagsSchema,
  BulkArticleStateResultSchema,
  EnrichmentEnqueuedSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import {
  articleNotFound,
  normalizeProblem,
  resourceConflict,
  unavailable,
} from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 記事の閲覧・状態更新・アーカイブと、記事単位のタグ／AI補完。
 * 上流の状態語彙をHTTPの公開語彙へ落とし、所有者はアクターからのみ導く。
 */

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>
type PublicArticleTags = TypeOf<typeof ArticleTagsSchema>
type PublicEnrichmentEnqueued = TypeOf<typeof EnrichmentEnqueuedSchema>

const publicListState = {
  all: "All",
  unread: "Unread",
  saved: "Saved",
  later: "Later",
} as const

const toUpstreamState = (state: keyof typeof publicListState | undefined) =>
  state === undefined ? "All" : publicListState[state]

const toPublicArticle = (
  article: Schema.Schema.Type<typeof ContentArticleViewSchema>
) =>
  parse(ArticleSchema)({
    id: article.articleId,
    feedId: article.feedId,
    sourceName: new URL(article.sourceUrl).hostname,
    title: article.title,
    url: article.sourceUrl,
    ...(article.publishedAt === null
      ? {}
      : { publishedAt: article.publishedAt }),
    discoveredAt: article.discoveredAt,
    archiveStatus:
      article.archiveStatus === "Pending" ? "pending" : "succeeded",
    ...(article.snapshotId === null ? {} : { snapshotId: article.snapshotId }),
    read: article.state.read,
    saved: article.state.saved,
    readLater: article.state.readLater,
    hidden: article.state.hidden,
    ...(article.state.hiddenAt === null
      ? {}
      : { hiddenAt: article.state.hiddenAt }),
  }).pipe(Effect.mapError(unavailable))

// 記事ライブラリの「見つからない」は2通りの形で返るため、片方だけを404にしない。
const articleReplyFailure = (reply: ArticleLibraryReply) =>
  reply._tag === "NotFound" ||
  (reply._tag === "Rejected" && reply.code === "NOT_FOUND")
    ? articleNotFound()
    : unavailable()

const toPublicTags = (
  tags: readonly { readonly source: "Manual" | "Ai" | string }[]
) =>
  tags.map((tag) => ({
    ...tag,
    source: tag.source === "Manual" ? "manual" : "ai",
  }))

type ArticlePorts = Pick<
  GatewayPorts,
  | "listArticles"
  | "getArticle"
  | "getArticleMarkdown"
  | "patchArticle"
  | "bulkPatchArticles"
  | "getArticleFacets"
  | "archiveArticle"
  | "listArticleTags"
  | "setArticleTags"
  | "enrichArticle"
>

export const makeArticlePorts = (transport: Transport): ArticlePorts => {
  const libraryRpc = (
    headers: Parameters<GatewayPorts["getArticle"]>[0]["headers"],
    payload: unknown
  ) =>
    transport.ownerRpc(
      headers,
      subjects.content.articleLibrary,
      "content-knowledge",
      payload,
      parseArticleLibraryReply
    )

  const personalizationRpc = (
    headers: Parameters<GatewayPorts["getArticle"]>[0]["headers"],
    payload: unknown
  ) =>
    transport.ownerRpc(
      headers,
      subjects.content.personalization,
      "content-knowledge",
      payload,
      parseContentPersonalizationReply
    )

  return {
    listArticles: ({ headers, query }) =>
      libraryRpc(headers, {
        operation: "List",
        query: {
          limit: query.limit ?? 50,
          state: toUpstreamState(query.state),
          includeHidden: query.includeHidden ?? false,
          feedIds: query.feedIds ?? [],
          ...(query.q === undefined ? {} : { q: query.q }),
          order: query.sort === "oldest" ? "Oldest" : "Newest",
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Listed"
            ? Effect.forEach(reply.articles, toPublicArticle).pipe(
                Effect.flatMap((items) =>
                  parse(ArticlePageSchema)({
                    items,
                    page:
                      reply.nextCursor === null
                        ? { hasMore: false }
                        : { hasMore: true, nextCursor: reply.nextCursor },
                  }).pipe(Effect.mapError(unavailable))
                )
              )
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    getArticle: ({ headers, articleId }) =>
      libraryRpc(headers, { operation: "Find", articleId }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Found"
            ? toPublicArticle(reply.article)
            : Effect.fail(articleReplyFailure(reply))
        ),
        Effect.mapError(normalizeProblem)
      ),
    getArticleMarkdown: ({ headers, articleId }) =>
      libraryRpc(headers, { operation: "Markdown", articleId }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Markdown"
            ? parse(ArticleMarkdownSchema)({ markdown: reply.markdown }).pipe(
                Effect.mapError(unavailable)
              )
            : Effect.fail(articleReplyFailure(reply))
        ),
        Effect.mapError(normalizeProblem)
      ),
    patchArticle: ({ headers, articleId, payload }) =>
      libraryRpc(headers, {
        operation: "Patch",
        articleId,
        patch: payload,
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Updated"
            ? toPublicArticle(reply.article)
            : Effect.fail(articleReplyFailure(reply))
        ),
        Effect.mapError(normalizeProblem)
      ),
    bulkPatchArticles: ({ headers, payload }) => {
      const { read, saved, readLater, hidden, ...filter } = payload
      return libraryRpc(headers, {
        operation: "BulkPatch",
        query: {
          state: toUpstreamState(filter.state),
          includeHidden: filter.includeHidden ?? false,
          feedIds: filter.feedIds ?? [],
          ...(filter.q === undefined ? {} : { q: filter.q }),
        },
        patch: {
          ...(read === undefined ? {} : { read }),
          ...(saved === undefined ? {} : { saved }),
          ...(readLater === undefined ? {} : { readLater }),
          ...(hidden === undefined ? {} : { hidden }),
        },
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "BulkUpdated"
            ? parse(BulkArticleStateResultSchema)({
                updated: reply.updated,
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      )
    },
    getArticleFacets: ({ headers, query }) =>
      libraryRpc(headers, {
        operation: "Facets",
        query: {
          includeHidden: query.includeHidden ?? false,
          feedIds: query.feedIds ?? [],
          ...(query.q === undefined ? {} : { q: query.q }),
        },
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Facets"
            ? parse(ArticleFacetsSchema)({
                ...reply.facets,
                feeds: reply.facets.feeds.map((feed) => ({
                  ...feed,
                  name: feed.feedId,
                })),
                aiPending: 0,
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    archiveArticle: ({ headers, articleId }) =>
      libraryRpc(headers, { operation: "Archive", articleId }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "ArchiveTriggered"
            ? parse(ArticleArchiveResultSchema)({
                status:
                  reply.status === "Archived" ? "archived" : "already_archived",
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(articleReplyFailure(reply))
        ),
        Effect.mapError(normalizeProblem)
      ),
    listArticleTags: ({ headers, articleId }) =>
      personalizationRpc(headers, {
        operation: "ListArticleTags",
        articleId,
      }).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            PublicArticleTags,
            ReturnType<typeof articleNotFound> | ReturnType<typeof unavailable>
          > =>
            reply._tag === "ArticleTags"
              ? parse(ArticleTagsSchema)({
                  items: toPublicTags(reply.tags),
                }).pipe(Effect.mapError(unavailable))
              : reply._tag === "NotFound"
                ? Effect.fail(articleNotFound())
                : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    setArticleTags: ({ headers, articleId, payload }) =>
      personalizationRpc(headers, {
        operation: "SetArticleTags",
        articleId,
        tagIds: payload.tagIds,
      }).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            PublicArticleTags,
            | ReturnType<typeof articleNotFound>
            | ReturnType<typeof resourceConflict>
            | ReturnType<typeof unavailable>
          > =>
            reply._tag === "ArticleTags"
              ? parse(ArticleTagsSchema)({
                  items: toPublicTags(reply.tags),
                }).pipe(Effect.mapError(unavailable))
              : reply._tag === "NotFound"
                ? Effect.fail(articleNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(resourceConflict())
                  : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
    enrichArticle: ({ headers, articleId }) =>
      personalizationRpc(headers, {
        operation: "EnrichArticle",
        articleId,
      }).pipe(
        Effect.flatMap(
          (
            reply
          ): Effect.Effect<
            PublicEnrichmentEnqueued,
            | ReturnType<typeof articleNotFound>
            | ReturnType<typeof resourceConflict>
            | ReturnType<typeof unavailable>
          > =>
            reply._tag === "Enqueued"
              ? parse(EnrichmentEnqueuedSchema)({
                  enqueued: reply.count,
                }).pipe(Effect.mapError(unavailable))
              : reply._tag === "NotFound"
                ? Effect.fail(articleNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(resourceConflict())
                  : Effect.fail(unavailable())
        ),
        Effect.mapError(normalizeProblem)
      ),
  }
}
