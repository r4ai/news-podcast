import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

import {
  ArticleIdSchema,
  ArticleTitleSchema,
  ArticleUrlSchema,
  CapturedAtSchema,
  type CapturedAt,
  SnapshotIdSchema,
} from "./article.js"
import { FeedIdSchema } from "./subscription.js"

export const ArticleArchiveStatusSchema = Schema.Literals([
  "Pending",
  "Succeeded",
])
export type ArticleArchiveStatus = Schema.Schema.Type<
  typeof ArticleArchiveStatusSchema
>

const consistentHiddenState = Schema.makeFilter<{
  readonly hidden: boolean
  readonly hiddenAt: CapturedAt | null
}>((state) =>
  state.hidden === (state.hiddenAt !== null)
    ? true
    : "hiddenAt must exist exactly while an article is hidden"
)

export const ArticleStateSchema = Schema.Struct({
  read: Schema.Boolean,
  saved: Schema.Boolean,
  readLater: Schema.Boolean,
  hidden: Schema.Boolean,
  hiddenAt: Schema.NullOr(CapturedAtSchema),
}).check(consistentHiddenState)
export type ArticleState = Schema.Schema.Type<typeof ArticleStateSchema>

const atLeastOneState = Schema.makeFilter<{
  readonly read?: boolean
  readonly saved?: boolean
  readonly readLater?: boolean
  readonly hidden?: boolean
}>((input) =>
  input.read !== undefined ||
  input.saved !== undefined ||
  input.readLater !== undefined ||
  input.hidden !== undefined
    ? true
    : "at least one article state field is required"
)

export const ArticleStatePatchSchema = Schema.Struct({
  read: Schema.optional(Schema.Boolean),
  saved: Schema.optional(Schema.Boolean),
  readLater: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
}).check(atLeastOneState)
export type ArticleStatePatch = Schema.Schema.Type<
  typeof ArticleStatePatchSchema
>

export const ArticleViewSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  feedId: FeedIdSchema,
  title: ArticleTitleSchema,
  sourceUrl: ArticleUrlSchema,
  publishedAt: Schema.NullOr(CapturedAtSchema),
  discoveredAt: CapturedAtSchema,
  archiveStatus: ArticleArchiveStatusSchema,
  snapshotId: Schema.NullOr(SnapshotIdSchema),
  state: ArticleStateSchema,
})
export type ArticleView = Schema.Schema.Type<typeof ArticleViewSchema>

export const defaultArticleState = (): ArticleState =>
  deepFreeze({
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    hiddenAt: null,
  })

/**
 * 一覧の安定順序を決める唯一の基準。公開日時が無い記事は発見日時で並ぶ。
 * ISO-8601 UTCの固定書式なので、辞書順比較が時刻順比較と一致する。
 */
export const articleSortKey = (article: {
  readonly publishedAt: string | null
  readonly discoveredAt: string
}): string => article.publishedAt ?? article.discoveredAt

/** keysetページングの現在位置。`(sortKey, articleId)`でORDER BYと同じ全順序を張る。 */
export const ArticleCursorPositionSchema = Schema.Struct({
  sortKey: CapturedAtSchema,
  articleId: ArticleIdSchema,
})
export type ArticleCursorPosition = Schema.Schema.Type<
  typeof ArticleCursorPositionSchema
>

const decodePosition = (cursor: string): ArticleCursorPosition | undefined => {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    )
    return Schema.decodeUnknownSync(ArticleCursorPositionSchema)(json)
  } catch {
    return undefined
  }
}

/**
 * 位置を不透明tokenへ畳む。base64urlはあくまで詰め替えで、clientは中身に依存できない。
 * 復号できるかどうかだけがtokenの妥当性であり、書式検査は`ArticleCursorSchema`が担う。
 */
export const encodeArticleCursor = (position: ArticleCursorPosition): string =>
  Buffer.from(
    JSON.stringify({
      sortKey: position.sortKey,
      articleId: position.articleId,
    }),
    "utf8"
  ).toString("base64url")

/** 復号できないtokenは`undefined`。呼び出し側は不正要求として閉じる。 */
export const decodeArticleCursor = (
  cursor: string
): ArticleCursorPosition | undefined =>
  cursor.length === 0 ? undefined : decodePosition(cursor)

/** 復号可能なtokenだけを通す。改竄・切り捨てはここで落ちる。 */
export const ArticleCursorSchema = Schema.String.check(
  Schema.isMaxLength(512),
  Schema.makeFilter((cursor: string) =>
    decodeArticleCursor(cursor) === undefined
      ? "expected an opaque article cursor"
      : true
  )
)
