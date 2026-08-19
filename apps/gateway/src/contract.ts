import { deepFreeze } from "@news-podcast/kernel"
import { TraceparentSchema } from "@news-podcast/protocols"
import { Schema } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"

const boundedText = (maximum: number) =>
  Schema.NonEmptyString.check(
    Schema.isPattern(/\S/),
    Schema.isMaxLength(maximum)
  )

const UtcDateTimeStringSchema = Schema.String.check(
  Schema.makeFilter<string>(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value
        ? undefined
        : "Expected an ISO 8601 UTC timestamp",
    { format: "date-time", expected: "an ISO 8601 UTC timestamp" }
  )
).pipe(Schema.brand("UtcDateTimeString"))

const AbsoluteHttpUrlSchema = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => {
      try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === ""
          ? undefined
          : "Expected an absolute HTTP URL without credentials"
      } catch {
        return "Expected an absolute HTTP URL"
      }
    },
    { format: "uri", expected: "an absolute HTTP URL" }
  )
).pipe(Schema.brand("AbsoluteHttpUrl"))

const CanonicalFeedUrlSchema = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter<string>(
    (value) => {
      try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === "" &&
          url.hash === "" &&
          url.href === value
          ? undefined
          : "Expected a canonical credential-free HTTP(S) feed URL"
      } catch {
        return "Expected an absolute HTTP(S) feed URL"
      }
    },
    {
      format: "uri",
      expected: "a canonical credential-free HTTP(S) feed URL",
    }
  )
).pipe(Schema.brand("CanonicalFeedUrl"))

export const ArticleIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ArticleId")
)
export const EpisodeIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("EpisodeId")
)
export const JobIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("EpisodeJobId")
)
export const SubscriptionIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ContentSubscriptionId")
)
export const FeedSyncJobIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("FeedSyncJobId")
)
const FeedIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ContentFeedId")
)
const SnapshotIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("SnapshotId")
)
const UserIdSchema = boundedText(255).pipe(Schema.brand("PublicUserId"))

export const HealthResponseSchema = Schema.Struct({
  status: Schema.Literal("ok"),
}).annotate({ identifier: "HealthResponse" })

export const LoginMethodsSchema = Schema.Struct({
  development: Schema.Boolean,
  google: Schema.Boolean,
}).annotate({ identifier: "LoginMethods" })

export const SessionResponseSchema = Schema.Union([
  Schema.Struct({
    authenticated: Schema.Literal(false),
    loginMethods: LoginMethodsSchema,
  }),
  Schema.Struct({
    authenticated: Schema.Literal(true),
    userId: UserIdSchema,
    loginMethods: LoginMethodsSchema,
  }),
]).annotate({ identifier: "SessionResponse" })

export const SessionHeadersSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  cookie: Schema.optional(Schema.String),
  traceparent: Schema.optional(TraceparentSchema),
}).annotate({ identifier: "SessionHeaders" })

export const EpisodeAudioHeadersSchema = Schema.Struct({
  ...SessionHeadersSchema.fields,
  range: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
}).annotate({ identifier: "EpisodeAudioHeaders" })

export const CreateEpisodeJobHeadersSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  cookie: Schema.optional(Schema.String),
  "idempotency-key": boundedText(128),
  traceparent: Schema.optional(TraceparentSchema),
}).annotate({ identifier: "CreateEpisodeJobHeaders" })

export const CreateEpisodeJobRequestSchema = Schema.Struct({
  trigger: Schema.Literal("manual"),
  articleIds: Schema.Array(ArticleIdSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
    Schema.isUnique()
  ),
}).annotate({ identifier: "CreateEpisodeJobRequest" })

export const JobStatusSchema = Schema.Literals([
  "queued",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "canceled",
]).annotate({ identifier: "JobStatus" })

export const JobStageSchema = Schema.Literals([
  "selecting_articles",
  "materializing_articles",
  "generating_script",
  "preparing_pronunciation",
  "synthesizing_audio",
  "storing_episode",
]).annotate({ identifier: "JobStage" })

export const JobReceiptSchema = Schema.Struct({
  id: JobIdSchema,
  status: JobStatusSchema,
  createdAt: UtcDateTimeStringSchema,
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
})
  .annotate({ identifier: "JobReceipt" })
  .pipe(HttpApiSchema.status(202))

const JobReceiptWithLocationSchema = HttpApiSchema.WithHeaders(
  JobReceiptSchema,
  {
    Location: Schema.String.check(
      Schema.isPattern(/^\/v1\/episode-jobs\/[0-9a-f-]{36}$/)
    ).annotate({ description: "Canonical URL of the accepted episode job." }),
  }
)

const jobFields = {
  id: JobIdSchema,
  status: JobStatusSchema,
  createdAt: UtcDateTimeStringSchema,
  articleIds: Schema.optional(Schema.Array(ArticleIdSchema)),
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
  stage: Schema.optional(JobStageSchema),
  stageStartedAt: Schema.optional(UtcDateTimeStringSchema),
  lastProgressAt: Schema.optional(UtcDateTimeStringSchema),
  deadlineAt: Schema.optional(UtcDateTimeStringSchema),
  stageProgress: Schema.optional(
    Schema.Struct({
      completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      total: Schema.Int.check(Schema.isGreaterThan(0)),
    })
  ),
  startedAt: Schema.optional(UtcDateTimeStringSchema),
  finishedAt: Schema.optional(UtcDateTimeStringSchema),
  nextAttemptAt: Schema.optional(UtcDateTimeStringSchema),
  episodeId: Schema.optional(EpisodeIdSchema),
  failure: Schema.optional(
    Schema.Struct({
      code: boundedText(200),
      message: boundedText(500),
      retryable: Schema.Boolean,
    })
  ),
} as const

export const EpisodeJobSchema = Schema.Struct(jobFields).annotate({
  identifier: "EpisodeJob",
})
export const EpisodeJobPageSchema = Schema.Struct({
  items: Schema.Array(EpisodeJobSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "EpisodeJobPage" })

export const ListEpisodeJobsQuerySchema = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    )
  ),
}).annotate({ identifier: "ListEpisodeJobsQuery" })

export const RetryEpisodeJobHeadersSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  cookie: Schema.optional(Schema.String),
  "idempotency-key": Schema.optional(boundedText(128)),
  traceparent: Schema.optional(TraceparentSchema),
}).annotate({ identifier: "RetryEpisodeJobHeaders" })

export const EpisodeJobEventsHeadersSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  cookie: Schema.optional(Schema.String),
  "last-event-id": Schema.optional(Schema.String),
  traceparent: Schema.optional(TraceparentSchema),
}).annotate({ identifier: "EpisodeJobEventsHeaders" })
export const EpisodeJobEventsQuerySchema = Schema.Struct({
  lastEventId: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0)
    )
  ),
}).annotate({ identifier: "EpisodeJobEventsQuery" })

const EpisodeJobStateSchema = Schema.Struct({
  jobId: JobIdSchema,
  status: jobFields.status,
  attempt: jobFields.attempt,
  maxAttempts: Schema.Literal(4),
  selectionMode: Schema.Literals(["automatic", "manual"]),
  selectedArticles: Schema.Array(
    Schema.Struct({
      articleId: ArticleIdSchema,
      title: Schema.optional(boundedText(500)),
      sourceName: Schema.optional(boundedText(500)),
    })
  ),
  currentStage: Schema.optional(JobStageSchema),
  failure: Schema.optional(
    Schema.Struct({
      code: boundedText(200),
      message: boundedText(500),
      retryable: Schema.Boolean,
    })
  ),
  episodeId: Schema.optional(EpisodeIdSchema),
})
const AgUiTimestampSchema = Schema.optional(Schema.Number)
export const EpisodeJobAgUiEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("STATE_SNAPSHOT"),
    timestamp: AgUiTimestampSchema,
    snapshot: EpisodeJobStateSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("RUN_STARTED"),
    timestamp: AgUiTimestampSchema,
    threadId: Schema.String,
    runId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("RUN_FINISHED"),
    timestamp: AgUiTimestampSchema,
    threadId: Schema.String,
    runId: Schema.String,
    outcome: Schema.optional(
      Schema.Struct({ type: Schema.Literal("success") })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("RUN_ERROR"),
    timestamp: AgUiTimestampSchema,
    message: Schema.String,
    code: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literals(["STEP_STARTED", "STEP_FINISHED"]),
    timestamp: AgUiTimestampSchema,
    stepName: JobStageSchema,
  }),
])
const EpisodeJobSseEventSchema = Schema.Struct({
  id: Schema.UndefinedOr(Schema.String),
  // Effect's SSE encoder omits the wire field for the default "message" name.
  event: Schema.Literal("message"),
  data: Schema.fromJsonString(EpisodeJobAgUiEventSchema),
})
export const EpisodeJobEventStreamSchema = HttpApiSchema.StreamSse({
  events: EpisodeJobSseEventSchema,
})

const EpisodeSourceSchema = Schema.Struct({
  articleId: Schema.optional(ArticleIdSchema),
  url: AbsoluteHttpUrlSchema,
  title: boundedText(500),
  publishedAt: Schema.optional(UtcDateTimeStringSchema),
  snapshotId: Schema.optional(SnapshotIdSchema),
  sourceKind: Schema.optional(Schema.Literals(["rss", "web"])),
}).annotate({ identifier: "EpisodeSource" })

export const EpisodeSchema = Schema.Struct({
  id: EpisodeIdSchema,
  title: boundedText(500),
  script: boundedText(20_000),
  sources: Schema.Array(EpisodeSourceSchema).check(Schema.isMinLength(1)),
  createdAt: UtcDateTimeStringSchema,
}).annotate({ identifier: "Episode" })

export const EpisodePageSchema = Schema.Struct({
  items: Schema.Array(EpisodeSchema),
  page: Schema.Struct({
    hasMore: Schema.Boolean,
    nextCursor: Schema.optional(boundedText(1_000)),
  }),
}).annotate({ identifier: "EpisodePage" })

export const AudioAccessSchema = Schema.Struct({
  url: AbsoluteHttpUrlSchema,
  expiresAt: UtcDateTimeStringSchema,
}).annotate({ identifier: "AudioAccess" })

export const AddFeedSubscriptionRequestSchema = Schema.Struct({
  feedUrl: CanonicalFeedUrlSchema,
}).annotate({ identifier: "AddFeedSubscriptionRequest" })

const feedSubscriptionFields = {
  id: SubscriptionIdSchema,
  feedId: FeedIdSchema,
  enabled: Schema.Boolean,
  createdAt: UtcDateTimeStringSchema,
} as const

export const FeedSubscriptionSchema = Schema.Struct(
  feedSubscriptionFields
).annotate({ identifier: "FeedSubscription" })

export const CreatedFeedSubscriptionSchema = Schema.Struct(
  feedSubscriptionFields
)
  .annotate({ identifier: "CreatedFeedSubscription" })
  .pipe(HttpApiSchema.status(201))

export const FeedSubscriptionPageSchema = Schema.Struct({
  items: Schema.Array(FeedSubscriptionSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "FeedSubscriptionPage" })
export const FeedSyncJobSchema = Schema.Struct({
  jobId: FeedSyncJobIdSchema,
  feedId: FeedIdSchema,
  feedUrl: CanonicalFeedUrlSchema,
  status: Schema.Literals(["queued", "processing", "succeeded", "failed"]),
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
  discovered: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  archived: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: UtcDateTimeStringSchema,
  startedAt: Schema.optional(UtcDateTimeStringSchema),
  completedAt: Schema.optional(UtcDateTimeStringSchema),
  error: Schema.optional(boundedText(200)),
}).annotate({ identifier: "FeedSyncJob" })
export const FeedSyncJobPageSchema = Schema.Struct({
  items: Schema.Array(FeedSyncJobSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "FeedSyncJobPage" })
export const UpdateFeedSubscriptionSchema = Schema.Struct({
  enabled: Schema.Boolean,
})
export const UpdatedFeedSubscriptionSchema = Schema.Struct({
  ...feedSubscriptionFields,
}).annotate({ identifier: "UpdatedFeedSubscription" })
export const FeedSchema = Schema.Struct({
  id: FeedIdSchema,
  name: boundedText(500),
  siteUrl: AbsoluteHttpUrlSchema,
  feedUrl: CanonicalFeedUrlSchema,
}).annotate({ identifier: "Feed" })
export const FeedPageSchema = Schema.Struct({
  items: Schema.Array(FeedSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "FeedPage" })
export const RegisteredFeedSchema = Schema.Struct({
  feed: FeedSchema,
  subscription: FeedSubscriptionSchema,
})
  .annotate({ identifier: "RegisteredFeed" })
  .pipe(HttpApiSchema.status(201))

const ArticleStateFilterSchema = Schema.Literals([
  "all",
  "unread",
  "saved",
  "later",
])
const ArticleStatePatchFields = {
  read: Schema.optional(Schema.Boolean),
  saved: Schema.optional(Schema.Boolean),
  readLater: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
} as const
export const ArticleStatePatchSchema = Schema.Struct(
  ArticleStatePatchFields
).check(
  Schema.makeFilter(
    (value) =>
      Object.values(value).some((item) => item !== undefined) ||
      "at least one state field is required"
  )
)
export const ArticleSchema = Schema.Struct({
  id: ArticleIdSchema,
  feedId: FeedIdSchema,
  sourceName: boundedText(500),
  title: boundedText(500),
  url: AbsoluteHttpUrlSchema,
  publishedAt: Schema.optional(UtcDateTimeStringSchema),
  summary: Schema.optional(Schema.String),
  discoveredAt: UtcDateTimeStringSchema,
  archiveStatus: Schema.Literals([
    "pending",
    "archiving",
    "succeeded",
    "failed",
  ]),
  snapshotId: Schema.optional(SnapshotIdSchema),
  read: Schema.Boolean,
  saved: Schema.Boolean,
  readLater: Schema.Boolean,
  hidden: Schema.Boolean,
  hiddenAt: Schema.optional(UtcDateTimeStringSchema),
  archiveUrl: Schema.optional(Schema.String),
  markdownUrl: Schema.optional(Schema.String),
  aiSummary: Schema.optional(Schema.String),
  relevanceScore: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
  ),
  relevanceReason: Schema.optional(Schema.String),
}).annotate({ identifier: "Article" })
/**
 * 一覧の継続位置。中身は非公開で、clientはそのまま返すことだけを期待される
 * (docs/design.md §5「一覧はopaque cursor」)。
 */
const ArticleCursorSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/)
)
export const ArticlePageSchema = Schema.Struct({
  items: Schema.Array(ArticleSchema),
  page: Schema.Struct({
    hasMore: Schema.Boolean,
    /** `hasMore`が真の時だけ現れる。次ページ要求の`cursor`へそのまま渡す。 */
    nextCursor: Schema.optional(ArticleCursorSchema),
  }),
}).annotate({ identifier: "ArticlePage" })
export const ArticleFacetsSchema = Schema.Struct({
  states: Schema.Struct({
    all: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    unread: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    saved: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    later: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  feeds: Schema.Array(
    Schema.Struct({
      feedId: FeedIdSchema,
      name: boundedText(500),
      count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    })
  ),
  aiPending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ArticleFacets" })
export const BulkArticleStateSchema = Schema.Struct({
  state: Schema.optional(ArticleStateFilterSchema),
  includeHidden: Schema.optional(Schema.Boolean),
  feedIds: Schema.optional(Schema.Array(FeedIdSchema)),
  q: Schema.optional(boundedText(200)),
  ...ArticleStatePatchFields,
}).check(
  Schema.makeFilter(
    (value) =>
      value.read !== undefined ||
      value.saved !== undefined ||
      value.readLater !== undefined ||
      value.hidden !== undefined ||
      "at least one state field is required"
  )
)
export const BulkArticleStateResultSchema = Schema.Struct({
  updated: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export const ArticleMarkdownSchema = Schema.Struct({
  markdown: Schema.String.check(Schema.isMaxLength(1_048_576)),
})
export const ArticleArchiveResultSchema = Schema.Struct({
  status: Schema.Literals(["archived", "already_archived"]),
})
export const ArticleTagSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  tagId: Schema.String.check(Schema.isUUID(4)),
  name: boundedText(50),
  source: Schema.Literals(["manual", "ai"]),
  confidence: Schema.NullOr(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  ),
})
export const ArticleTagsSchema = Schema.Struct({
  items: Schema.Array(ArticleTagSchema).check(Schema.isMaxLength(100)),
})
export const SetArticleTagsSchema = Schema.Struct({
  tagIds: Schema.Array(Schema.String.check(Schema.isUUID(4))).check(
    Schema.isMaxLength(100)
  ),
})

export const GenerationScheduleSchema = Schema.Struct({
  enabled: Schema.Boolean,
  localTime: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  ),
  timeZone: boundedText(100),
}).annotate({ identifier: "GenerationSchedule" })
export const InterestProfileSchema = Schema.Struct({
  include: Schema.String.check(Schema.isMaxLength(2_000)),
  exclude: Schema.String.check(Schema.isMaxLength(2_000)),
}).annotate({ identifier: "InterestProfile" })
export const UserSettingsSchema = Schema.Struct({
  generationSchedule: GenerationScheduleSchema,
  interestProfile: InterestProfileSchema,
}).annotate({ identifier: "UserSettings" })
export const UpdateSettingsSchema = Schema.Union([
  Schema.Struct({
    generationSchedule: GenerationScheduleSchema,
    interestProfile: Schema.optional(InterestProfileSchema),
  }),
  Schema.Struct({
    generationSchedule: Schema.optional(GenerationScheduleSchema),
    interestProfile: InterestProfileSchema,
  }),
]).annotate({ identifier: "UpdateSettings" })

const TagIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("TagId")
)
const TagNameSchema = boundedText(50)
const tagFields = {
  id: TagIdSchema,
  name: TagNameSchema,
  createdAt: UtcDateTimeStringSchema,
} as const
export const TagSchema = Schema.Struct(tagFields).annotate({
  identifier: "Tag",
})
export const TagPageSchema = Schema.Struct({
  items: Schema.Array(TagSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "TagPage" })
export const TagSuggestionSchema = Schema.Struct({
  name: TagNameSchema,
  occurrences: Schema.Int.check(Schema.isGreaterThan(0)),
  lastSeenAt: UtcDateTimeStringSchema,
}).annotate({ identifier: "TagSuggestion" })
export const TagSuggestionPageSchema = Schema.Struct({
  items: Schema.Array(TagSuggestionSchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "TagSuggestionPage" })
export const CreateTagSchema = Schema.Struct({ name: TagNameSchema })
export const CreatedTagSchema = Schema.Struct(tagFields)
  .annotate({ identifier: "CreatedTag" })
  .pipe(HttpApiSchema.status(201))

const ReadingTextSchema = boundedText(100)
const readingDictionaryFields = {
  id: Schema.String.check(Schema.isUUID(4)),
  surface: ReadingTextSchema,
  reading: ReadingTextSchema,
  accentType: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  source: Schema.Literals(["manual", "ai_auto"]),
  episodeJobId: Schema.optional(JobIdSchema),
  createdAt: UtcDateTimeStringSchema,
  updatedAt: UtcDateTimeStringSchema,
} as const
export const ReadingDictionaryEntrySchema = Schema.Struct(
  readingDictionaryFields
).annotate({ identifier: "ReadingDictionaryEntry" })
export const ReadingDictionaryPageSchema = Schema.Struct({
  items: Schema.Array(ReadingDictionaryEntrySchema),
  page: Schema.Struct({ hasMore: Schema.Literal(false) }),
}).annotate({ identifier: "ReadingDictionaryPage" })
export const CreateReadingDictionarySchema = Schema.Struct({
  surface: ReadingTextSchema,
  reading: ReadingTextSchema,
  accentType: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
  ),
})
export const UpdateReadingDictionarySchema = Schema.Union([
  Schema.Struct({
    surface: ReadingTextSchema,
    reading: Schema.optional(ReadingTextSchema),
    accentType: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
    ),
  }),
  Schema.Struct({
    surface: Schema.optional(ReadingTextSchema),
    reading: ReadingTextSchema,
    accentType: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
    ),
  }),
  Schema.Struct({
    surface: Schema.optional(ReadingTextSchema),
    reading: Schema.optional(ReadingTextSchema),
    accentType: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 100 })
    ),
  }),
])
export const CreatedReadingDictionaryEntrySchema = Schema.Struct(
  readingDictionaryFields
)
  .annotate({ identifier: "CreatedReadingDictionaryEntry" })
  .pipe(HttpApiSchema.status(201))

export const EnrichQueueItemSchema = Schema.Struct({
  feedItemId: ArticleIdSchema,
  title: Schema.String,
  sourceName: Schema.String,
  priority: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  reason: Schema.Literals(["new", "reprocess"]),
  status: Schema.Literals(["queued", "processing", "succeeded", "failed"]),
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  error: Schema.optional(Schema.String),
  publishedAt: Schema.optional(UtcDateTimeStringSchema),
  createdAt: UtcDateTimeStringSchema,
  startedAt: Schema.optional(UtcDateTimeStringSchema),
  completedAt: Schema.optional(UtcDateTimeStringSchema),
}).annotate({ identifier: "EnrichQueueItem" })
export const EnrichQueueSchema = Schema.Struct({
  processing: Schema.Array(EnrichQueueItemSchema),
  pending: Schema.Struct({
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    items: Schema.Array(EnrichQueueItemSchema),
  }),
  failed: Schema.Struct({
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    items: Schema.Array(EnrichQueueItemSchema),
  }),
  recent: Schema.Array(EnrichQueueItemSchema),
  daily: Schema.Struct({
    used: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    limit: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  reprocessable: Schema.Struct({
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
}).annotate({ identifier: "EnrichQueue" })
export const EnrichmentEnqueuedSchema = Schema.Struct({
  enqueued: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export const EnrichmentResetSchema = Schema.Struct({
  message: Schema.Literal("Daily enrichment usage reset"),
})

const problemSchema = <const Status extends number>(
  status: Status,
  identifier: string
) =>
  Schema.Struct({
    type: Schema.String,
    title: boundedText(200),
    status: Schema.Literal(status),
    code: boundedText(100),
    detail: Schema.optional(Schema.String),
  })
    .annotate({ identifier })
    .pipe(HttpApiSchema.status(status))

export const BadRequestProblemSchema = problemSchema(400, "BadRequestProblem")
export const UnauthorizedProblemSchema = problemSchema(
  401,
  "UnauthorizedProblem"
)
export const ConflictProblemSchema = problemSchema(409, "ConflictProblem")
export const UnprocessableProblemSchema = problemSchema(
  422,
  "UnprocessableProblem"
)
export const NotFoundProblemSchema = problemSchema(404, "NotFoundProblem")
export const UnavailableProblemSchema = problemSchema(503, "UnavailableProblem")

export const healthEndpoint = HttpApiEndpoint.get("health", "/health", {
  success: HealthResponseSchema,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "health",
    summary: "Runtime health",
  })
)

export const resolveSessionEndpoint = HttpApiEndpoint.get(
  "resolveSession",
  "/api/auth/state",
  {
    headers: SessionHeadersSchema,
    success: SessionResponseSchema,
    error: UnavailableProblemSchema,
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "resolveSession",
    summary: "Resolve the current session",
  })
)

export const createEpisodeJobEndpoint = HttpApiEndpoint.post(
  "createEpisodeJob",
  "/v1/episode-jobs",
  {
    headers: CreateEpisodeJobHeadersSchema,
    payload: CreateEpisodeJobRequestSchema,
    success: JobReceiptWithLocationSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      ConflictProblemSchema,
      UnprocessableProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "createEpisodeJob",
    summary: "Create an idempotent episode job",
  })
)

export const listEpisodesEndpoint = HttpApiEndpoint.get(
  "listEpisodes",
  "/v1/episodes",
  {
    headers: SessionHeadersSchema,
    query: Schema.Struct({ cursor: Schema.optional(boundedText(1_000)) }),
    success: EpisodePageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "listEpisodes",
    summary: "List completed episodes",
  })
)

export const listEpisodeJobsEndpoint = HttpApiEndpoint.get(
  "listEpisodeJobs",
  "/v1/episode-jobs",
  {
    headers: SessionHeadersSchema,
    query: ListEpisodeJobsQuerySchema,
    success: EpisodeJobPageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "listEpisodeJobs",
    summary: "List episode jobs",
  })
)

export const getEpisodeJobEndpoint = HttpApiEndpoint.get(
  "getEpisodeJob",
  "/v1/episode-jobs/:jobId",
  {
    params: { jobId: JobIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeJobSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "getEpisodeJob",
    summary: "Get an episode job",
  })
)

export const cancelEpisodeJobEndpoint = HttpApiEndpoint.post(
  "cancelEpisodeJob",
  "/v1/episode-jobs/:jobId/cancel",
  {
    params: { jobId: JobIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeJobSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "cancelEpisodeJob",
    summary: "Cancel an episode job",
  })
)

export const retryEpisodeJobEndpoint = HttpApiEndpoint.post(
  "retryEpisodeJob",
  "/v1/episode-jobs/:jobId/retry",
  {
    params: { jobId: JobIdSchema },
    headers: RetryEpisodeJobHeadersSchema,
    success: JobReceiptSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "retryEpisodeJob",
    summary: "Retry an episode job",
  })
)

export const streamEpisodeJobEventsEndpoint = HttpApiEndpoint.get(
  "streamEpisodeJobEvents",
  "/v1/episode-jobs/:jobId/events",
  {
    params: { jobId: JobIdSchema },
    headers: EpisodeJobEventsHeadersSchema,
    query: EpisodeJobEventsQuerySchema,
    success: EpisodeJobEventStreamSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "streamEpisodeJobEvents",
    summary: "Replay episode job events",
  })
)

export const getEpisodeEndpoint = HttpApiEndpoint.get(
  "getEpisode",
  "/v1/episodes/:episodeId",
  {
    params: { episodeId: EpisodeIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "getEpisode",
    summary: "Get a completed episode",
  })
)

export const streamEpisodeAudioEndpoint = HttpApiEndpoint.get(
  "streamEpisodeAudio",
  "/v1/episodes/:episodeId/audio",
  {
    params: { episodeId: EpisodeIdSchema },
    headers: EpisodeAudioHeadersSchema,
    success: HttpApiSchema.StreamUint8Array({ contentType: "audio/wav" }),
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "streamEpisodeAudio",
    summary: "Stream owned episode audio",
  })
)

export const addFeedSubscriptionEndpoint = HttpApiEndpoint.post(
  "addFeedSubscription",
  "/v1/me/feed-subscriptions",
  {
    headers: SessionHeadersSchema,
    payload: AddFeedSubscriptionRequestSchema,
    success: CreatedFeedSubscriptionSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      UnprocessableProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "addFeedSubscription",
    summary: "Subscribe to an RSS feed URL",
  })
)

export const listFeedSubscriptionsEndpoint = HttpApiEndpoint.get(
  "listFeedSubscriptions",
  "/v1/me/feed-subscriptions",
  {
    headers: SessionHeadersSchema,
    success: FeedSubscriptionPageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "listFeedSubscriptions",
    summary: "List feed subscriptions",
  })
)

export const listFeedSyncJobsEndpoint = HttpApiEndpoint.get(
  "listFeedSyncJobs",
  "/v1/me/feed-sync-jobs",
  {
    headers: SessionHeadersSchema,
    success: FeedSyncJobPageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "listFeedSyncJobs",
    summary: "List RSS feed synchronization jobs",
  })
)

export const syncFeedSubscriptionEndpoint = HttpApiEndpoint.post(
  "syncFeedSubscription",
  "/v1/me/feed-subscriptions/:subscriptionId/sync",
  {
    params: { subscriptionId: SubscriptionIdSchema },
    headers: SessionHeadersSchema,
    success: FeedSyncJobSchema.pipe(HttpApiSchema.status(202)).annotate({
      identifier: "AcceptedFeedSyncJob",
    }),
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "syncFeedSubscription",
    summary: "Start an immediate RSS feed synchronization",
  })
)

export const deleteFeedSubscriptionEndpoint = HttpApiEndpoint.delete(
  "deleteFeedSubscription",
  "/v1/me/feed-subscriptions/:subscriptionId",
  {
    params: { subscriptionId: SubscriptionIdSchema },
    headers: SessionHeadersSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "deleteFeedSubscription",
    summary: "Delete a feed subscription",
  })
)
export const updateFeedSubscriptionEndpoint = HttpApiEndpoint.patch(
  "updateFeedSubscription",
  "/v1/me/feed-subscriptions/:subscriptionId",
  {
    params: { subscriptionId: SubscriptionIdSchema },
    headers: SessionHeadersSchema,
    payload: UpdateFeedSubscriptionSchema,
    success: UpdatedFeedSubscriptionSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const listFeedsEndpoint = HttpApiEndpoint.get("listFeeds", "/v1/feeds", {
  headers: SessionHeadersSchema,
  query: Schema.Struct({ q: Schema.optional(boundedText(200)) }),
  success: FeedPageSchema,
  error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
})
export const registerFeedEndpoint = HttpApiEndpoint.post(
  "registerFeed",
  "/v1/feeds",
  {
    headers: SessionHeadersSchema,
    payload: AddFeedSubscriptionRequestSchema,
    success: RegisteredFeedSchema,
    error: [
      UnauthorizedProblemSchema,
      UnprocessableProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)

const ArticleListFilterSchema = Schema.Struct({
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  ),
  state: Schema.optional(ArticleStateFilterSchema),
  includeHidden: Schema.optional(Schema.Boolean),
  feedIds: Schema.optional(Schema.Array(FeedIdSchema)),
  q: Schema.optional(boundedText(200)),
  sort: Schema.optional(Schema.Literals(["newest", "oldest"])),
  /** 直前ページの`page.nextCursor`。絞り込みを変えたら破棄する。 */
  cursor: Schema.optional(ArticleCursorSchema),
})
const ArticleFacetsQuerySchema = Schema.Struct({
  includeHidden: Schema.optional(Schema.Boolean),
  feedIds: Schema.optional(Schema.Array(FeedIdSchema)),
  q: Schema.optional(boundedText(200)),
})
export const listArticlesEndpoint = HttpApiEndpoint.get(
  "listArticles",
  "/v1/me/articles",
  {
    headers: SessionHeadersSchema,
    query: ArticleListFilterSchema,
    success: ArticlePageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const getArticleFacetsEndpoint = HttpApiEndpoint.get(
  "getArticleFacets",
  "/v1/me/articles/facets",
  {
    headers: SessionHeadersSchema,
    query: ArticleFacetsQuerySchema,
    success: ArticleFacetsSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const getArticleEndpoint = HttpApiEndpoint.get(
  "getArticle",
  "/v1/me/articles/:articleId",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    success: ArticleSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const getArticleMarkdownEndpoint = HttpApiEndpoint.get(
  "getArticleMarkdown",
  "/v1/me/articles/:articleId/markdown",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    success: ArticleMarkdownSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const patchArticleEndpoint = HttpApiEndpoint.patch(
  "patchArticle",
  "/v1/me/articles/:articleId",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    payload: ArticleStatePatchSchema,
    success: ArticleSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const bulkPatchArticlesEndpoint = HttpApiEndpoint.post(
  "bulkPatchArticles",
  "/v1/me/articles/bulk-state",
  {
    headers: SessionHeadersSchema,
    payload: BulkArticleStateSchema,
    success: BulkArticleStateResultSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const archiveArticleEndpoint = HttpApiEndpoint.post(
  "archiveArticle",
  "/v1/me/articles/:articleId/archive",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    success: ArticleArchiveResultSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const listArticleTagsEndpoint = HttpApiEndpoint.get(
  "listArticleTags",
  "/v1/me/articles/:articleId/tags",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    success: ArticleTagsSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const setArticleTagsEndpoint = HttpApiEndpoint.put(
  "setArticleTags",
  "/v1/me/articles/:articleId/tags",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    payload: SetArticleTagsSchema,
    success: ArticleTagsSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const enrichArticleEndpoint = HttpApiEndpoint.post(
  "enrichArticle",
  "/v1/me/articles/:articleId/enrich",
  {
    headers: SessionHeadersSchema,
    params: { articleId: ArticleIdSchema },
    success: EnrichmentEnqueuedSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)

export const getSettingsEndpoint = HttpApiEndpoint.get(
  "getSettings",
  "/v1/me/settings",
  {
    headers: SessionHeadersSchema,
    success: UserSettingsSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const updateSettingsEndpoint = HttpApiEndpoint.patch(
  "updateSettings",
  "/v1/me/settings",
  {
    headers: SessionHeadersSchema,
    payload: UpdateSettingsSchema,
    success: UserSettingsSchema,
    error: [
      BadRequestProblemSchema,
      UnauthorizedProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const listTagsEndpoint = HttpApiEndpoint.get("listTags", "/v1/me/tags", {
  headers: SessionHeadersSchema,
  success: TagPageSchema,
  error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
})
export const createTagEndpoint = HttpApiEndpoint.post(
  "createTag",
  "/v1/me/tags",
  {
    headers: SessionHeadersSchema,
    payload: CreateTagSchema,
    success: CreatedTagSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const deleteTagEndpoint = HttpApiEndpoint.delete(
  "deleteTag",
  "/v1/me/tags/:tagId",
  {
    headers: SessionHeadersSchema,
    params: { tagId: TagIdSchema },
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const listTagSuggestionsEndpoint = HttpApiEndpoint.get(
  "listTagSuggestions",
  "/v1/me/tag-suggestions",
  {
    headers: SessionHeadersSchema,
    success: TagSuggestionPageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const promoteTagSuggestionEndpoint = HttpApiEndpoint.post(
  "promoteTagSuggestion",
  "/v1/me/tag-suggestions/promote",
  {
    headers: SessionHeadersSchema,
    payload: CreateTagSchema,
    success: CreatedTagSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const listReadingDictionaryEndpoint = HttpApiEndpoint.get(
  "listReadingDictionary",
  "/v1/me/reading-dictionary",
  {
    headers: SessionHeadersSchema,
    success: ReadingDictionaryPageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const createReadingDictionaryEndpoint = HttpApiEndpoint.post(
  "createReadingDictionary",
  "/v1/me/reading-dictionary",
  {
    headers: SessionHeadersSchema,
    payload: CreateReadingDictionarySchema,
    success: CreatedReadingDictionaryEntrySchema,
    error: [
      UnauthorizedProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const updateReadingDictionaryEndpoint = HttpApiEndpoint.put(
  "updateReadingDictionary",
  "/v1/me/reading-dictionary/:id",
  {
    headers: SessionHeadersSchema,
    params: { id: Schema.String.check(Schema.isUUID(4)) },
    payload: UpdateReadingDictionarySchema,
    success: ReadingDictionaryEntrySchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      ConflictProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const deleteReadingDictionaryEndpoint = HttpApiEndpoint.delete(
  "deleteReadingDictionary",
  "/v1/me/reading-dictionary/:id",
  {
    headers: SessionHeadersSchema,
    params: { id: Schema.String.check(Schema.isUUID(4)) },
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
)
export const getEnrichQueueEndpoint = HttpApiEndpoint.get(
  "getEnrichQueue",
  "/v1/me/enrich/queue",
  {
    headers: SessionHeadersSchema,
    success: EnrichQueueSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const enrichReprocessEndpoint = HttpApiEndpoint.post(
  "enrichReprocess",
  "/v1/me/enrich/reprocess",
  {
    headers: SessionHeadersSchema,
    success: EnrichmentEnqueuedSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)
export const enrichResetDailyEndpoint = HttpApiEndpoint.post(
  "enrichResetDaily",
  "/v1/me/enrich/reset-daily",
  {
    headers: SessionHeadersSchema,
    success: EnrichmentResetSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
)

const systemGroup = HttpApiGroup.make("system")
  .add(healthEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "System" }))
const sessionGroup = HttpApiGroup.make("session")
  .add(resolveSessionEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Session" }))
const episodeJobsGroup = HttpApiGroup.make("episodeJobs")
  .add(
    createEpisodeJobEndpoint,
    listEpisodeJobsEndpoint,
    getEpisodeJobEndpoint,
    cancelEpisodeJobEndpoint,
    retryEpisodeJobEndpoint,
    streamEpisodeJobEventsEndpoint
  )
  .annotateMerge(OpenApi.annotations({ title: "Episode jobs" }))
const episodesGroup = HttpApiGroup.make("episodes")
  .add(listEpisodesEndpoint, getEpisodeEndpoint, streamEpisodeAudioEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Episodes" }))
const feedSubscriptionsGroup = HttpApiGroup.make("feedSubscriptions")
  .add(
    addFeedSubscriptionEndpoint,
    listFeedSubscriptionsEndpoint,
    listFeedSyncJobsEndpoint,
    syncFeedSubscriptionEndpoint,
    deleteFeedSubscriptionEndpoint,
    updateFeedSubscriptionEndpoint
  )
  .annotateMerge(OpenApi.annotations({ title: "Feed subscriptions" }))
const feedsGroup = HttpApiGroup.make("feeds")
  .add(listFeedsEndpoint, registerFeedEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Feeds" }))
const articlesGroup = HttpApiGroup.make("articles")
  .add(
    listArticlesEndpoint,
    getArticleFacetsEndpoint,
    getArticleEndpoint,
    getArticleMarkdownEndpoint,
    patchArticleEndpoint,
    bulkPatchArticlesEndpoint,
    archiveArticleEndpoint,
    listArticleTagsEndpoint,
    setArticleTagsEndpoint,
    enrichArticleEndpoint
  )
  .annotateMerge(OpenApi.annotations({ title: "Articles" }))
const personalizationGroup = HttpApiGroup.make("personalization")
  .add(
    getSettingsEndpoint,
    updateSettingsEndpoint,
    listTagsEndpoint,
    createTagEndpoint,
    deleteTagEndpoint,
    listTagSuggestionsEndpoint,
    promoteTagSuggestionEndpoint,
    listReadingDictionaryEndpoint,
    createReadingDictionaryEndpoint,
    updateReadingDictionaryEndpoint,
    deleteReadingDictionaryEndpoint,
    getEnrichQueueEndpoint,
    enrichReprocessEndpoint,
    enrichResetDailyEndpoint
  )
  .annotateMerge(OpenApi.annotations({ title: "Personalization" }))
export const gatewayApi = HttpApi.make("gateway")
  .add(
    systemGroup,
    sessionGroup,
    episodeJobsGroup,
    episodesGroup,
    feedSubscriptionsGroup,
    feedsGroup,
    articlesGroup,
    personalizationGroup
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "RSS News Podcast API",
      version: "1.0.0",
      description: "Public gateway contract for RSS News Podcast.",
    })
  )

export const generateOpenApi = () => deepFreeze(OpenApi.fromApi(gatewayApi))
