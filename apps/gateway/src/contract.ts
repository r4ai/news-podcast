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

export const ArticleIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ArticleId")
)
export const EpisodeIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("EpisodeId")
)
export const JobIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("EpisodeJobId")
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
    success: EpisodePageSchema,
    error: [UnauthorizedProblemSchema, UnavailableProblemSchema],
  }
).annotateMerge(
  OpenApi.annotations({
    identifier: "listEpisodes",
    summary: "List completed episodes",
  })
)

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

const systemGroup = HttpApiGroup.make("system")
  .add(healthEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "System" }))
const sessionGroup = HttpApiGroup.make("session")
  .add(resolveSessionEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Session" }))
const episodeJobsGroup = HttpApiGroup.make("episodeJobs")
  .add(createEpisodeJobEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Episode jobs" }))
const episodesGroup = HttpApiGroup.make("episodes")
  .add(listEpisodesEndpoint, createAudioAccessEndpoint)
  .annotateMerge(OpenApi.annotations({ title: "Episodes" }))

export const gatewayApi = HttpApi.make("gateway")
  .add(systemGroup, sessionGroup, episodeJobsGroup, episodesGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "RSS News Podcast API",
      version: "1.0.0",
      description: "Public gateway contract for RSS News Podcast.",
    })
  )

export const generateOpenApi = () =>
  deepFreeze(structuredClone(OpenApi.fromApi(gatewayApi)))
