import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))
const bounded = (maximum: number) =>
  Schema.NonEmptyString.check(
    Schema.isPattern(/\S/),
    Schema.isMaxLength(maximum)
  )
const UtcInstantSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value: string) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
      ? true
      : "expected a real UTC instant"
  )
)
const HttpUrlSchema = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((value: string) => {
    try {
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === "" &&
        url.hash === "" &&
        url.href === value
        ? true
        : "expected a canonical credential-free HTTP(S) URL"
    } catch {
      return "expected an absolute HTTP(S) URL"
    }
  })
)

const SubscriptionIdSchema = uuid("ContentSubscriptionId")
const FeedIdSchema = uuid("ContentFeedId")
const ArticleIdSchema = uuid("ContentArticleId")
const SnapshotIdSchema = uuid("ContentSnapshotId")

export const ContentFeedSubscriptionSchema = Schema.Struct({
  subscriptionId: SubscriptionIdSchema,
  feedId: FeedIdSchema,
  feedUrl: HttpUrlSchema,
  enabled: Schema.Boolean,
  createdAt: UtcInstantSchema,
})

export const AddFeedSubscriptionRequestSchema = Schema.Struct({
  feedUrl: HttpUrlSchema,
})
export type AddFeedSubscriptionRequest = Schema.Schema.Type<
  typeof AddFeedSubscriptionRequestSchema
>
export const parseAddFeedSubscriptionRequest = parse(
  AddFeedSubscriptionRequestSchema
)

export const ListFeedSubscriptionsRequestSchema = Schema.Struct({})
export const parseListFeedSubscriptionsRequest = parse(
  ListFeedSubscriptionsRequestSchema
)

export const DeleteFeedSubscriptionRequestSchema = Schema.Struct({
  subscriptionId: SubscriptionIdSchema,
})
export type DeleteFeedSubscriptionRequest = Schema.Schema.Type<
  typeof DeleteFeedSubscriptionRequestSchema
>
export const parseDeleteFeedSubscriptionRequest = parse(
  DeleteFeedSubscriptionRequestSchema
)

export const UpdateFeedSubscriptionRequestSchema = Schema.Struct({
  subscriptionId: SubscriptionIdSchema,
  enabled: Schema.Boolean,
})
export const parseUpdateFeedSubscriptionRequest = parse(
  UpdateFeedSubscriptionRequestSchema
)
export const ListFeedCatalogRequestSchema = Schema.Struct({
  q: Schema.optional(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(200)
    )
  ),
})
export const parseListFeedCatalogRequest = parse(ListFeedCatalogRequestSchema)

export const ContentKnowledgeRejectionSchema = Schema.TaggedStruct("Rejected", {
  code: Schema.Literals([
    "INVALID_REQUEST",
    "UNAUTHENTICATED",
    "NOT_FOUND",
    "STORAGE_FAILURE",
    "OBJECT_FAILURE",
    "INTERNAL_ERROR",
  ]),
})
export type ContentKnowledgeRejection = Schema.Schema.Type<
  typeof ContentKnowledgeRejectionSchema
>

export const AddFeedSubscriptionReplySchema = Schema.Union([
  Schema.TaggedStruct("Added", { subscription: ContentFeedSubscriptionSchema }),
  ContentKnowledgeRejectionSchema,
])
export type AddFeedSubscriptionReply = Schema.Schema.Type<
  typeof AddFeedSubscriptionReplySchema
>
export const parseAddFeedSubscriptionReply = parse(
  AddFeedSubscriptionReplySchema
)
export const ListFeedSubscriptionsReplySchema = Schema.Union([
  Schema.TaggedStruct("Listed", {
    subscriptions: Schema.Array(ContentFeedSubscriptionSchema),
  }),
  ContentKnowledgeRejectionSchema,
])
export type ListFeedSubscriptionsReply = Schema.Schema.Type<
  typeof ListFeedSubscriptionsReplySchema
>
export const parseListFeedSubscriptionsReply = parse(
  ListFeedSubscriptionsReplySchema
)
export const DeleteFeedSubscriptionReplySchema = Schema.Union([
  Schema.TaggedStruct("Deleted", {}),
  Schema.TaggedStruct("NotFound", {}),
  ContentKnowledgeRejectionSchema,
])
export type DeleteFeedSubscriptionReply = Schema.Schema.Type<
  typeof DeleteFeedSubscriptionReplySchema
>
export const parseDeleteFeedSubscriptionReply = parse(
  DeleteFeedSubscriptionReplySchema
)
export const UpdateFeedSubscriptionReplySchema = Schema.Union([
  Schema.TaggedStruct("Updated", {
    subscription: ContentFeedSubscriptionSchema,
    enabled: Schema.Boolean,
  }),
  Schema.TaggedStruct("NotFound", {}),
  ContentKnowledgeRejectionSchema,
])
export const parseUpdateFeedSubscriptionReply = parse(
  UpdateFeedSubscriptionReplySchema
)
export const ContentFeedCatalogEntrySchema = Schema.Struct({
  feedId: FeedIdSchema,
  feedUrl: HttpUrlSchema,
})
export const ListFeedCatalogReplySchema = Schema.Union([
  Schema.TaggedStruct("Catalog", {
    feeds: Schema.Array(ContentFeedCatalogEntrySchema).check(
      Schema.isMaxLength(100)
    ),
  }),
  ContentKnowledgeRejectionSchema,
])
export const parseListFeedCatalogReply = parse(ListFeedCatalogReplySchema)

export const MaterializeArticlesRequestSchema = Schema.Struct({
  selection: Schema.Union([
    Schema.TaggedStruct("Automatic", {}),
    Schema.TaggedStruct("Selected", {
      articleIds: Schema.NonEmptyArray(ArticleIdSchema).check(
        Schema.isMaxLength(20),
        Schema.makeFilter(
          (ids: readonly string[]) =>
            new Set(ids).size === ids.length || "article IDs must be unique"
        )
      ),
    }),
  ]),
})
export type MaterializeArticlesRequest = Schema.Schema.Type<
  typeof MaterializeArticlesRequestSchema
>
export const parseMaterializeArticlesRequest = parse(
  MaterializeArticlesRequestSchema
)

export const MaterializedArticleSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  snapshotId: SnapshotIdSchema,
  title: bounded(500),
  url: HttpUrlSchema,
  markdown: bounded(1_048_576),
  publishedAt: Schema.optional(UtcInstantSchema),
})
export const MaterializeArticlesReplySchema = Schema.Union([
  Schema.TaggedStruct("Materialized", {
    articles: Schema.NonEmptyArray(MaterializedArticleSchema).check(
      Schema.isMaxLength(20)
    ),
  }),
  Schema.TaggedStruct("NoArticles", {}),
  Schema.TaggedStruct("NotFound", {}),
  ContentKnowledgeRejectionSchema,
])
export type MaterializeArticlesReply = Schema.Schema.Type<
  typeof MaterializeArticlesReplySchema
>
export const parseMaterializeArticlesReply = parse(
  MaterializeArticlesReplySchema
)
