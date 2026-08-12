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

export const CreateEpisodeJobHeadersSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  cookie: Schema.optional(Schema.String),
  "idempotency-key": boundedText(255),
  traceparent: Schema.optional(TraceparentSchema),
}).annotate({ identifier: "CreateEpisodeJobHeaders" })

export const CreateEpisodeJobRequestSchema = Schema.Struct({
  trigger: Schema.Literal("manual"),
  articleIds: Schema.optional(
    Schema.Array(ArticleIdSchema).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20)
    )
  ),
}).annotate({ identifier: "CreateEpisodeJobRequest" })

export const JobReceiptSchema = Schema.Struct({
  id: JobIdSchema,
  status: Schema.Literals([
    "queued",
    "running",
    "retrying",
    "succeeded",
    "failed",
    "canceled",
  ]),
  createdAt: UtcDateTimeStringSchema,
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
})
  .annotate({ identifier: "JobReceipt" })
  .pipe(HttpApiSchema.status(202))

const jobFields = {
  id: JobIdSchema,
  status: Schema.Literals([
    "queued",
    "running",
    "retrying",
    "succeeded",
    "failed",
    "canceled",
  ]),
  createdAt: UtcDateTimeStringSchema,
  articleIds: Schema.optional(Schema.Array(ArticleIdSchema)),
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
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
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
}).annotate({ identifier: "EpisodeJobEventsQuery" })

const EpisodeJobStateSchema = Schema.Struct({
  jobId: JobIdSchema,
  status: jobFields.status,
  attempt: jobFields.attempt,
  maxAttempts: Schema.Literal(4),
  adoptedArticles: Schema.Array(Schema.Unknown),
  failure: Schema.optional(
    Schema.Struct({ code: boundedText(200), message: boundedText(500) })
  ),
  episodeId: Schema.optional(EpisodeIdSchema),
})
export const EpisodeJobAgUiEventSchema = Schema.Struct({
  type: Schema.Literal("STATE_SNAPSHOT"),
  timestamp: Schema.Number,
  snapshot: EpisodeJobStateSchema,
})
const EpisodeJobSseEventSchema = Schema.Struct({
  id: Schema.UndefinedOr(Schema.String),
  event: Schema.Literal("STATE_SNAPSHOT"),
  data: Schema.fromJsonString(EpisodeJobAgUiEventSchema),
})
export const EpisodeJobEventStreamSchema = HttpApiSchema.StreamSse({
  events: EpisodeJobSseEventSchema,
})

const EpisodeSourceSchema = Schema.Struct({
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
  subscriptionId: SubscriptionIdSchema,
  feedId: FeedIdSchema,
  feedUrl: CanonicalFeedUrlSchema,
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
    success: JobReceiptSchema,
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
).annotateMerge(OpenApi.annotations({ identifier: "listEpisodeJobs", summary: "List episode jobs" }))

export const getEpisodeJobEndpoint = HttpApiEndpoint.get(
  "getEpisodeJob",
  "/v1/episode-jobs/:jobId",
  {
    params: { jobId: JobIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeJobSchema,
    error: [UnauthorizedProblemSchema, NotFoundProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(OpenApi.annotations({ identifier: "getEpisodeJob", summary: "Get an episode job" }))

export const cancelEpisodeJobEndpoint = HttpApiEndpoint.post(
  "cancelEpisodeJob",
  "/v1/episode-jobs/:jobId/cancel",
  {
    params: { jobId: JobIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeJobSchema,
    error: [UnauthorizedProblemSchema, NotFoundProblemSchema, ConflictProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(OpenApi.annotations({ identifier: "cancelEpisodeJob", summary: "Cancel an episode job" }))

export const retryEpisodeJobEndpoint = HttpApiEndpoint.post(
  "retryEpisodeJob",
  "/v1/episode-jobs/:jobId/retry",
  {
    params: { jobId: JobIdSchema },
    headers: RetryEpisodeJobHeadersSchema,
    success: JobReceiptSchema,
    error: [UnauthorizedProblemSchema, NotFoundProblemSchema, ConflictProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(OpenApi.annotations({ identifier: "retryEpisodeJob", summary: "Retry an episode job" }))

export const streamEpisodeJobEventsEndpoint = HttpApiEndpoint.get(
  "streamEpisodeJobEvents",
  "/v1/episode-jobs/:jobId/events",
  {
    params: { jobId: JobIdSchema },
    headers: EpisodeJobEventsHeadersSchema,
    query: EpisodeJobEventsQuerySchema,
    success: EpisodeJobEventStreamSchema,
    error: [UnauthorizedProblemSchema, NotFoundProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(OpenApi.annotations({ identifier: "streamEpisodeJobEvents", summary: "Replay episode job events" }))

export const getEpisodeEndpoint = HttpApiEndpoint.get(
  "getEpisode",
  "/v1/episodes/:episodeId",
  {
    params: { episodeId: EpisodeIdSchema },
    headers: SessionHeadersSchema,
    success: EpisodeSchema,
    error: [UnauthorizedProblemSchema, NotFoundProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(OpenApi.annotations({ identifier: "getEpisode", summary: "Get a completed episode" }))

export const createAudioAccessEndpoint = HttpApiEndpoint.post(
  "createAudioAccess",
  "/v1/episodes/:episodeId/audio-access",
  {
    params: { episodeId: EpisodeIdSchema },
    headers: SessionHeadersSchema,
    success: AudioAccessSchema,
    error: [
      UnauthorizedProblemSchema,
      NotFoundProblemSchema,
      UnavailableProblemSchema,
    ],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "createAudioAccess",
    summary: "Issue short-lived audio access",
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
  .add(listEpisodesEndpoint, getEpisodeEndpoint, createAudioAccessEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Episodes" }))
const feedSubscriptionsGroup = HttpApiGroup.make("feedSubscriptions")
  .add(
    addFeedSubscriptionEndpoint,
    listFeedSubscriptionsEndpoint,
    deleteFeedSubscriptionEndpoint
  )
  .annotateMerge(OpenApi.annotations({ title: "Feed subscriptions" }))

export const gatewayApi = HttpApi.make("gateway")
  .add(
    systemGroup,
    sessionGroup,
    episodeJobsGroup,
    episodesGroup,
    feedSubscriptionsGroup
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "RSS News Podcast API",
      version: "1.0.0",
      description: "Public gateway contract for RSS News Podcast.",
    })
  )

export const generateOpenApi = () =>
  deepFreeze(structuredClone(OpenApi.fromApi(gatewayApi)))
