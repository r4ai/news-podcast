import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))
const ArticleIdSchema = uuid("ContentArticleId")
const FeedIdSchema = uuid("ContentFeedId")
const SnapshotIdSchema = uuid("ContentSnapshotId")
const utc = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value: string) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
      ? true
      : "expected a real UTC instant"
  )
)
const url = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((value: string) => {
    try {
      const parsed = new URL(value)
      return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === "" &&
        parsed.href === value
        ? true
        : "expected a canonical credential-free HTTP(S) URL"
    } catch {
      return "expected an absolute HTTP(S) URL"
    }
  })
)
const uniqueFeedIds = Schema.makeFilter<readonly string[]>((ids) =>
  new Set(ids).size === ids.length ? true : "feed IDs must be unique"
)
const filters = {
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
} as const
const state = Schema.Literals(["All", "Unread", "Saved", "Later"])
/**
 * 一覧の継続位置。中身はContent Knowledgeだけが解釈する不透明tokenで、
 * この境界では「base64urlの有界文字列」であることだけを保証する。
 */
const cursor = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/)
)
const patchFields = {
  read: Schema.optional(Schema.Boolean),
  saved: Schema.optional(Schema.Boolean),
  readLater: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
} as const
const patch = Schema.Struct(patchFields).check(
  Schema.makeFilter(
    (value) =>
      Object.values(value).some((item) => item !== undefined) ||
      "at least one state field is required"
  )
)

export const ArticleLibraryRequestSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("List"),
    query: Schema.Struct({
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
      state,
      ...filters,
      order: Schema.Literals(["Newest", "Oldest"]),
      cursor: Schema.optional(cursor),
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("Find"),
    articleId: ArticleIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("Markdown"),
    articleId: ArticleIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("Patch"),
    articleId: ArticleIdSchema,
    patch,
  }),
  Schema.Struct({
    operation: Schema.Literal("BulkPatch"),
    query: Schema.Struct({ state, ...filters }),
    patch,
  }),
  Schema.Struct({
    operation: Schema.Literal("Facets"),
    query: Schema.Struct(filters),
  }),
  Schema.Struct({
    operation: Schema.Literal("Archive"),
    articleId: ArticleIdSchema,
  }),
])

const ArticleStateSchema = Schema.Struct({
  read: Schema.Boolean,
  saved: Schema.Boolean,
  readLater: Schema.Boolean,
  hidden: Schema.Boolean,
  hiddenAt: Schema.NullOr(utc),
})
export const ContentArticleViewSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  feedId: FeedIdSchema,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
  sourceUrl: url,
  publishedAt: Schema.NullOr(utc),
  discoveredAt: utc,
  archiveStatus: Schema.Literals(["Pending", "Succeeded"]),
  snapshotId: Schema.NullOr(SnapshotIdSchema),
  state: ArticleStateSchema,
})
const rejection = Schema.TaggedStruct("Rejected", {
  code: Schema.Literals([
    "INVALID_REQUEST",
    "UNAUTHENTICATED",
    "NOT_FOUND",
    "STORAGE_FAILURE",
    "OBJECT_FAILURE",
    "INTERNAL_ERROR",
  ]),
})
export const ArticleLibraryReplySchema = Schema.Union([
  Schema.TaggedStruct("Listed", {
    articles: Schema.Array(ContentArticleViewSchema).check(
      Schema.isMaxLength(100)
    ),
    /** 次ページが無ければ`null`。省略は許さず、常に明示させる。 */
    nextCursor: Schema.NullOr(cursor),
  }),
  Schema.TaggedStruct("Found", { article: ContentArticleViewSchema }),
  Schema.TaggedStruct("Markdown", {
    markdown: Schema.String.check(Schema.isMaxLength(1_048_576)),
  }),
  Schema.TaggedStruct("Updated", { article: ContentArticleViewSchema }),
  Schema.TaggedStruct("BulkUpdated", {
    updated: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.TaggedStruct("Facets", {
    facets: Schema.Struct({
      states: Schema.Struct({
        all: Schema.Int,
        unread: Schema.Int,
        saved: Schema.Int,
        later: Schema.Int,
      }),
      feeds: Schema.Array(
        Schema.Struct({
          feedId: FeedIdSchema,
          feedUrl: url,
          count: Schema.Int,
        })
      ).check(Schema.isMaxLength(100)),
    }),
  }),
  Schema.TaggedStruct("ArchiveTriggered", {
    status: Schema.Literals(["Archived", "AlreadyArchived"]),
  }),
  Schema.TaggedStruct("NotFound", {}),
  rejection,
])

export type ArticleLibraryRequest = Schema.Schema.Type<
  typeof ArticleLibraryRequestSchema
>
export type ArticleLibraryReply = Schema.Schema.Type<
  typeof ArticleLibraryReplySchema
>
export const parseArticleLibraryRequest = parse(ArticleLibraryRequestSchema)
export const parseArticleLibraryReply = parse(ArticleLibraryReplySchema)
