import { Schema } from "effect"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))

export const SubscriptionIdSchema = uuid("SubscriptionId")
export type SubscriptionId = Schema.Schema.Type<typeof SubscriptionIdSchema>

export const FeedIdSchema = uuid("FeedId")
export type FeedId = Schema.Schema.Type<typeof FeedIdSchema>

export const OwnerIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^\S+$/),
  Schema.isMaxLength(255)
).pipe(Schema.brand("OwnerId"))
export type OwnerId = Schema.Schema.Type<typeof OwnerIdSchema>

const canonicalHttpUrl = Schema.makeFilter<string>((input) => {
  try {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "feed URL must use HTTP or HTTPS"
    }
    if (url.username !== "" || url.password !== "") {
      return "feed URL must not contain credentials"
    }
    if (url.hash !== "" || input.includes("#"))
      return "feed URL must not contain a fragment"
    return url.href === input || "feed URL must be canonical"
  } catch {
    return "feed URL must be absolute"
  }
})

export const FeedUrlSchema = Schema.String.check(
  Schema.isMaxLength(2_048),
  canonicalHttpUrl
).pipe(Schema.brand("FeedUrl"))
export type FeedUrl = Schema.Schema.Type<typeof FeedUrlSchema>

export const CreatedAtSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((input: string) =>
    Number.isFinite(Date.parse(input)) &&
    new Date(input).toISOString() === input
      ? true
      : "createdAt must be a real UTC instant"
  )
).pipe(Schema.brand("CreatedAt"))
export type CreatedAt = Schema.Schema.Type<typeof CreatedAtSchema>

export const FeedSubscriptionSchema = Schema.Struct({
  subscriptionId: SubscriptionIdSchema,
  feedId: FeedIdSchema,
  ownerId: OwnerIdSchema,
  feedUrl: FeedUrlSchema,
  enabled: Schema.optional(Schema.Boolean),
  createdAt: CreatedAtSchema,
})
export type FeedSubscription = Schema.Schema.Type<typeof FeedSubscriptionSchema>

export const PollingFeedSchema = Schema.Struct({
  feedId: FeedIdSchema,
  feedUrl: FeedUrlSchema,
})
export type PollingFeed = Schema.Schema.Type<typeof PollingFeedSchema>
