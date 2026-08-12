import { Schema } from "effect"

import {
  ArticleIdSchema,
  CapturedAtSchema,
  ObjectKeySchema,
} from "./article.js"
import { TagNameSchema } from "./content-taxonomy.js"
import { InterestProfileSchema } from "./interest-profile.js"

export const ENRICHMENT_MAX_ATTEMPTS = 4
export const ENRICHMENT_LEASE_MILLISECONDS = 10 * 60_000
export const ENRICHMENT_BATCH_LIMIT = 8
export const ENRICHMENT_MAX_MARKDOWN_CHARACTERS = 6_000
export const ENRICHMENT_MAX_ERROR_CHARACTERS = 500

export const EnrichmentReasonSchema = Schema.Literals(["New", "Reprocess"])
export type EnrichmentReason = Schema.Schema.Type<typeof EnrichmentReasonSchema>

export const EnrichmentStatusSchema = Schema.Literals([
  "Queued",
  "Processing",
  "Succeeded",
  "Failed",
])
export type EnrichmentStatus = Schema.Schema.Type<typeof EnrichmentStatusSchema>

export const EnrichmentTargetSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  title: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(500)
  ),
  markdownKey: ObjectKeySchema,
  leaseToken: Schema.String.check(
    Schema.isMinLength(16),
    Schema.isMaxLength(128)
  ),
})
export type EnrichmentTarget = Schema.Schema.Type<typeof EnrichmentTargetSchema>

export const EnrichmentQueueItemSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  title: Schema.String,
  priority: Schema.Int,
  reason: EnrichmentReasonSchema,
  status: EnrichmentStatusSchema,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(CapturedAtSchema),
  createdAt: CapturedAtSchema,
  startedAt: Schema.NullOr(CapturedAtSchema),
  completedAt: Schema.NullOr(CapturedAtSchema),
})
export type EnrichmentQueueItem = Schema.Schema.Type<
  typeof EnrichmentQueueItemSchema
>

export const EnrichmentProviderInputSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  title: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(500)
  ),
  markdown: Schema.String.check(
    Schema.isMaxLength(ENRICHMENT_MAX_MARKDOWN_CHARACTERS)
  ),
  interestProfile: InterestProfileSchema,
  tagVocabulary: Schema.Array(TagNameSchema).check(
    Schema.isMaxLength(100),
    Schema.makeFilter((names: readonly string[]) =>
      new Set(names).size === names.length
        ? true
        : "tag vocabulary must be unique"
    )
  ),
})
export type EnrichmentProviderInput = Schema.Schema.Type<
  typeof EnrichmentProviderInputSchema
>

const uniqueNames = Schema.makeFilter<readonly string[]>((names) =>
  new Set(names).size === names.length ? true : "tag names must be unique"
)

export const EnrichmentProviderOutputSchema = Schema.Struct({
  summary: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(2_000)
  ),
  score: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(100)
  ),
  reason: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000)
  ),
  tags: Schema.Array(TagNameSchema).check(Schema.isMaxLength(20), uniqueNames),
  suggestedTags: Schema.Array(TagNameSchema).check(
    Schema.isMaxLength(20),
    uniqueNames
  ),
  tokensIn: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  tokensOut: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type EnrichmentProviderOutput = Schema.Schema.Type<
  typeof EnrichmentProviderOutputSchema
>
