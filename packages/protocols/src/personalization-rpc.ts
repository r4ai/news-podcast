import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = Schema.String.check(Schema.isUUID(4))
const text = (maximum: number) =>
  Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(maximum)
  )
const instant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
)
const nonNegative = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const accentType = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100)
)
const localDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    if (year === undefined || month === undefined || day === undefined)
      return "expected a real local date"
    return new Date(Date.UTC(year, month - 1, day))
      .toISOString()
      .slice(0, 10) === value
      ? undefined
      : "expected a real local date"
  })
)
const reading = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isPattern(/^[ァ-ヶー・ ]+$/u)
)

export const GenerationScheduleWireSchema = Schema.Struct({
  enabled: Schema.Boolean,
  localTime: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  ),
  timeZone: text(100),
})
export const InterestProfileWireSchema = Schema.Struct({
  include: Schema.String.check(Schema.isMaxLength(2_000)),
  exclude: Schema.String.check(Schema.isMaxLength(2_000)),
})
export const IdentitySettingsRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("Get") }),
  Schema.Struct({
    operation: Schema.Literal("Update"),
    generationSchedule: GenerationScheduleWireSchema,
  }),
])
export const IdentitySettingsReplySchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Settings"),
    generationSchedule: GenerationScheduleWireSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
    ]),
  }),
])

export const DueGenerationWireSchema = Schema.Struct({
  ownerId: text(255),
  localDate,
})
export const ScheduledGenerationRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("DiscoverDue"), now: instant }),
  Schema.Struct({
    operation: Schema.Literal("Complete"),
    ownerId: text(255),
    localDate,
  }),
])
export const ScheduledGenerationReplySchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Due"),
    schedules: Schema.Array(DueGenerationWireSchema).check(
      Schema.isMaxLength(10_000)
    ),
  }),
  Schema.Struct({ _tag: Schema.Literal("Completed") }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
    ]),
  }),
])

export const TagWireSchema = Schema.Struct({
  tagId: uuid,
  name: text(50),
  createdAt: instant,
})
export const TagSuggestionWireSchema = Schema.Struct({
  name: text(50),
  occurrences: Schema.Int.check(Schema.isGreaterThan(0)),
  lastSeenAt: instant,
})
export const ArticleTagWireSchema = Schema.Struct({
  articleId: uuid,
  tagId: uuid,
  name: text(50),
  source: Schema.Literals(["Manual", "Ai"]),
  confidence: Schema.NullOr(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  ),
})
export const EnrichmentQueueItemWireSchema = Schema.Struct({
  articleId: uuid,
  title: Schema.String.check(Schema.isMaxLength(500)),
  sourceName: Schema.String.check(Schema.isMaxLength(500)),
  priority: nonNegative,
  reason: Schema.Literals(["New", "Reprocess"]),
  status: Schema.Literals(["Queued", "Processing", "Succeeded", "Failed"]),
  attempt: nonNegative,
  error: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  publishedAt: Schema.optional(instant),
  createdAt: instant,
  startedAt: Schema.optional(instant),
  completedAt: Schema.optional(instant),
})
export const EnrichmentQueueWireSchema = Schema.Struct({
  processing: Schema.Array(EnrichmentQueueItemWireSchema),
  pending: Schema.Struct({
    count: nonNegative,
    items: Schema.Array(EnrichmentQueueItemWireSchema),
  }),
  failed: Schema.Struct({
    count: nonNegative,
    items: Schema.Array(EnrichmentQueueItemWireSchema),
  }),
  recent: Schema.Array(EnrichmentQueueItemWireSchema),
  daily: Schema.Struct({
    used: nonNegative,
    limit: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  reprocessable: Schema.Struct({ count: nonNegative }),
})
export const ContentPersonalizationRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("GetInterestProfile") }),
  Schema.Struct({
    operation: Schema.Literal("UpdateInterestProfile"),
    interestProfile: InterestProfileWireSchema,
  }),
  Schema.Struct({ operation: Schema.Literal("ListTags") }),
  Schema.Struct({ operation: Schema.Literal("CreateTag"), name: text(50) }),
  Schema.Struct({ operation: Schema.Literal("DeleteTag"), tagId: uuid }),
  Schema.Struct({ operation: Schema.Literal("ListTagSuggestions") }),
  Schema.Struct({
    operation: Schema.Literal("PromoteTagSuggestion"),
    name: text(50),
  }),
  Schema.Struct({
    operation: Schema.Literal("SetArticleTags"),
    articleId: uuid,
    tagIds: Schema.Array(uuid).check(Schema.isMaxLength(100)),
  }),
  Schema.Struct({
    operation: Schema.Literal("ListArticleTags"),
    articleId: uuid,
  }),
  Schema.Struct({ operation: Schema.Literal("GetEnrichmentQueue") }),
  Schema.Struct({ operation: Schema.Literal("ReprocessEnrichment") }),
  Schema.Struct({
    operation: Schema.Literal("ResetDailyEnrichment"),
    localDate,
  }),
  Schema.Struct({
    operation: Schema.Literal("EnrichArticle"),
    articleId: uuid,
  }),
])
export const ContentPersonalizationReplySchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("InterestProfile"),
    interestProfile: InterestProfileWireSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Tags"),
    tags: Schema.Array(TagWireSchema),
  }),
  Schema.Struct({ _tag: Schema.Literal("Tag"), tag: TagWireSchema }),
  Schema.Struct({ _tag: Schema.Literal("Deleted") }),
  Schema.Struct({
    _tag: Schema.Literal("Suggestions"),
    suggestions: Schema.Array(TagSuggestionWireSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("ArticleTags"),
    tags: Schema.Array(ArticleTagWireSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("EnrichmentQueue"),
    queue: EnrichmentQueueWireSchema,
  }),
  Schema.Struct({ _tag: Schema.Literal("Enqueued"), count: nonNegative }),
  Schema.Struct({ _tag: Schema.Literal("Reset") }),
  Schema.Struct({ _tag: Schema.Literal("NotFound") }),
  Schema.Struct({
    _tag: Schema.Literal("Conflict"),
    code: Schema.Literals(["ARTICLE_NOT_ARCHIVED", "UNKNOWN_TAGS"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
      "PROVIDER_FAILURE",
    ]),
  }),
])

export const ReadingDictionaryEntryWireSchema = Schema.Struct({
  id: uuid,
  surface: text(100),
  reading,
  accentType,
  source: Schema.Literals(["manual", "ai_auto"]),
  episodeJobId: Schema.optional(uuid),
  createdAt: instant,
  updatedAt: instant,
})
export const ReadingDictionaryRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("List") }),
  Schema.Struct({
    operation: Schema.Literal("Create"),
    surface: text(100),
    reading,
    accentType: Schema.optional(accentType),
  }),
  Schema.Struct({
    operation: Schema.Literal("Update"),
    id: uuid,
    patch: Schema.Struct({
      surface: Schema.optional(text(100)),
      reading: Schema.optional(reading),
      accentType: Schema.optional(accentType),
    }),
  }),
  Schema.Struct({ operation: Schema.Literal("Delete"), id: uuid }),
])
export const ReadingDictionaryReplySchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Entries"),
    entries: Schema.Array(ReadingDictionaryEntryWireSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Entry"),
    entry: ReadingDictionaryEntryWireSchema,
  }),
  Schema.Struct({ _tag: Schema.Literal("Deleted") }),
  Schema.Struct({ _tag: Schema.Literal("NotFound") }),
  Schema.Struct({ _tag: Schema.Literal("Conflict") }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
    ]),
  }),
])

export const parseIdentitySettingsRequest = parse(IdentitySettingsRequestSchema)
export const parseIdentitySettingsReply = parse(IdentitySettingsReplySchema)
export const parseScheduledGenerationRequest = parse(
  ScheduledGenerationRequestSchema
)
export const parseScheduledGenerationReply = parse(
  ScheduledGenerationReplySchema
)
export const parseContentPersonalizationRequest = parse(
  ContentPersonalizationRequestSchema
)
export const parseContentPersonalizationReply = parse(
  ContentPersonalizationReplySchema
)
export const parseReadingDictionaryRequest = parse(
  ReadingDictionaryRequestSchema
)
export const parseReadingDictionaryReply = parse(ReadingDictionaryReplySchema)
