import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type {
  ObjectKey,
  ArticleId,
  ArticleTitle,
  ArticleUrl,
  SnapshotId,
} from "../../domain/article.js"
import type { FeedId, OwnerId } from "../../domain/subscription.js"

export type FeedItem = DeepReadonly<{
  readonly externalId: string
  readonly title: string
  readonly url: string
  readonly publishedAt?: string
}>

export type FeedFetchError = DeepReadonly<{
  readonly _tag: "FeedFetchFailed"
  readonly reason:
    | "Canceled"
    | "HttpStatus"
    | "MalformedResponse"
    | "ResourceLimit"
    | "Timeout"
    | "Unavailable"
}>

export type RssFeedReader = DeepReadonly<{
  readonly read: (
    url: import("../../domain/subscription.js").FeedUrl
  ) => Effect.Effect<readonly FeedItem[], FeedFetchError>
}>

export type CatalogArticle = DeepReadonly<{
  readonly articleId: ArticleId
  readonly snapshotId: SnapshotId
  readonly title: ArticleTitle
  readonly sourceUrl: ArticleUrl
  readonly markdownKey: ObjectKey
  readonly publishedAt?: string
}>

export type ArticleCatalogError = DeepReadonly<{
  readonly _tag: "ArticleCatalogFailed"
  readonly operation: "Find" | "Upsert"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type ArticleCatalog = DeepReadonly<{
  readonly upsert: (input: {
    readonly articleId: ArticleId
    readonly feedId: FeedId
    readonly externalId: string
    readonly sourceUrl: ArticleUrl
    readonly title: ArticleTitle
    readonly publishedAt?: string
    readonly discoveredAt: string
  }) => Effect.Effect<void, ArticleCatalogError>
  readonly findAutomatic: (
    ownerId: OwnerId,
    limit: number
  ) => Effect.Effect<readonly CatalogArticle[], ArticleCatalogError>
  readonly findSelected: (
    ownerId: OwnerId,
    articleIds: readonly ArticleId[]
  ) => Effect.Effect<readonly CatalogArticle[], ArticleCatalogError>
}>

export type MarkdownObjectError = DeepReadonly<{
  readonly _tag: "MarkdownObjectFailed"
  readonly reason:
    | "CorruptObject"
    | "NotFound"
    | "ResourceLimit"
    | "Unavailable"
}>

export type MarkdownObjectReader = DeepReadonly<{
  readonly read: (key: ObjectKey) => Effect.Effect<string, MarkdownObjectError>
}>
