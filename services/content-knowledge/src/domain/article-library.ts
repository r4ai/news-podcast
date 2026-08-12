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
