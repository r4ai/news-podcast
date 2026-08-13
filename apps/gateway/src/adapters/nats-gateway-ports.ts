import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  ActorSchema,
  type ArticleLibraryReply,
  ContentArticleViewSchema,
  type AddFeedSubscriptionReply,
  CorrelationIdSchema,
  type DeleteFeedSubscriptionReply,
  type ListFeedSyncJobsReply,
  type ListFeedSubscriptionsReply,
  type CreateAudioAccessReply,
  MessageEnvelopeSchema,
  parseAddFeedSubscriptionReply,
  parseArticleLibraryReply,
  parseCreateAudioAccessReply,
  parseDeleteFeedSubscriptionReply,
  parseEpisodeJobControlReply,
  parseGetEpisodeReply,
  parseListEpisodesReply,
  parseListFeedSubscriptionsReply,
  parseListFeedSyncJobsReply,
  parseListFeedCatalogReply,
  parseUpdateFeedSubscriptionReply,
  parseIdentitySettingsReply,
  parseContentPersonalizationReply,
  parseReadingDictionaryReply,
  parseMessageEnvelope,
  parseAgentAuditReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema, Scope } from "effect"

import {
  AudioAccessSchema,
  ArticleArchiveResultSchema,
  ArticleFacetsSchema,
  ArticleMarkdownSchema,
  ArticlePageSchema,
  ArticleSchema,
  ArticleTagsSchema,
  BulkArticleStateResultSchema,
  EpisodeJobPageSchema,
  EpisodeJobSchema,
  EpisodeSchema,
  EpisodePageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  FeedSyncJobPageSchema,
  FeedPageSchema,
  RegisteredFeedSchema,
  UpdatedFeedSubscriptionSchema,
  JobReceiptSchema,
  SessionResponseSchema,
  UserSettingsSchema,
  TagSchema,
  TagPageSchema,
  TagSuggestionPageSchema,
  ReadingDictionaryEntrySchema,
  ReadingDictionaryPageSchema,
  EnrichQueueSchema,
  EnrichmentEnqueuedSchema,
  AgentInstancePageSchema,
  AgentRunSchema,
  AgentMemorySchema,
  AgentMemoryPageSchema,
  AgentRunEventSchema,
  type SessionHeadersSchema,
} from "../contract.js"
import {
  connectNatsRequestClientUnsafe,
  type UnsafeNatsRequestClient,
} from "../infrastructure/unsafe/nats-request.js"
import {
  currentUtcInstantUnsafe,
  randomUuidUnsafe,
} from "../infrastructure/unsafe/runtime-values.js"
import type { GatewayPorts } from "../ports.js"

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>

const SessionReplySchema = Schema.Struct({ actor: ActorSchema })

export const ProductionCreateEpisodeJobResponseSchema = Schema.Union([
  Schema.Struct({
    protocolVersion: Schema.Literal("production.create-job.reply.v1"),
    _tag: Schema.Literal("Accepted"),
    correlationId: CorrelationIdSchema,
    jobId: Schema.String.check(Schema.isUUID(4)),
    state: Schema.Literal("Queued"),
  }),
  Schema.Struct({
    protocolVersion: Schema.Literal("production.create-job.reply.v1"),
    _tag: Schema.Literal("Rejected"),
    correlationId: Schema.NullOr(CorrelationIdSchema),
    code: Schema.String,
  }),
])

const unavailable = () =>
  deepFreeze({
    type: "about:blank",
    title: "Upstream unavailable",
    status: 503 as const,
    code: "upstream_unavailable",
  })
type AgentProblem =
  | ReturnType<typeof unavailable>
  | ReturnType<typeof notFound>
  | ReturnType<typeof conflict>
const agentUnavailable = (): AgentProblem => unavailable()
const agentNotFound = (): AgentProblem => notFound()
const agentConflict = (): AgentProblem => conflict()
const unauthorized = () =>
  deepFreeze({
    type: "about:blank",
    title: "Authentication required",
    status: 401 as const,
    code: "authentication_required",
  })
const conflict = () =>
  deepFreeze({
    type: "about:blank",
    title: "Idempotency conflict",
    status: 409 as const,
    code: "idempotency_conflict",
  })
const notFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Episode not found",
    status: 404 as const,
    code: "episode_not_found",
  })
const badRequest = () =>
  deepFreeze({
    type: "about:blank",
    title: "Invalid subscription request",
    status: 400 as const,
    code: "invalid_subscription_request",
  })
const unprocessable = () =>
  deepFreeze({
    type: "about:blank",
    title: "Feed subscription rejected",
    status: 422 as const,
    code: "feed_subscription_rejected",
  })
const subscriptionNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Feed subscription not found",
    status: 404 as const,
    code: "feed_subscription_not_found",
  })
const personalizationNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Resource not found",
    status: 404 as const,
    code: "resource_not_found",
  })
const personalizationConflict = () =>
  deepFreeze({
    type: "about:blank",
    title: "Resource conflict",
    status: 409 as const,
    code: "resource_conflict",
  })
const normalizePersonalizationFailure = (failure: unknown): any =>
  typeof failure === "object" && failure !== null && "status" in failure
    ? failure
    : unavailable()

const articleNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Article not found",
    status: 404 as const,
    code: "article_not_found",
  })
const toPublicArticle = (
  article: Schema.Schema.Type<typeof ContentArticleViewSchema>
) =>
  parse(ArticleSchema)({
    id: article.articleId,
    feedId: article.feedId,
    sourceName: new URL(article.sourceUrl).hostname,
    title: article.title,
    url: article.sourceUrl,
    ...(article.publishedAt === null
      ? {}
      : { publishedAt: article.publishedAt }),
    discoveredAt: article.discoveredAt,
    archiveStatus:
      article.archiveStatus === "Pending" ? "pending" : "succeeded",
    ...(article.snapshotId === null ? {} : { snapshotId: article.snapshotId }),
    read: article.state.read,
    saved: article.state.saved,
    readLater: article.state.readLater,
    hidden: article.state.hidden,
    ...(article.state.hiddenAt === null
      ? {}
      : { hiddenAt: article.state.hiddenAt }),
  }).pipe(Effect.mapError(unavailable))

const articleReplyFailure = (reply: ArticleLibraryReply) =>
  reply._tag === "NotFound" ||
  (reply._tag === "Rejected" && reply.code === "NOT_FOUND")
    ? articleNotFound()
    : unavailable()

type ParsedControlReply = Effect.Success<
  ReturnType<typeof parseEpisodeJobControlReply>
>
type ParsedProductionJob = Extract<
  ParsedControlReply,
  { readonly _tag: "Found" }
>["job"]
type ParsedGetEpisodeReply = Effect.Success<
  ReturnType<typeof parseGetEpisodeReply>
>
type PublicEpisodeJob = TypeOf<typeof EpisodeJobSchema>
type PublicEpisode = TypeOf<typeof EpisodeSchema>

type AudioAccess = TypeOf<typeof AudioAccessSchema>
type PublicArticleTags = TypeOf<typeof ArticleTagsSchema>
type PublicEnrichmentEnqueued = TypeOf<typeof EnrichmentEnqueuedSchema>
type AudioAccessFailure =
  | ReturnType<typeof notFound>
  | ReturnType<typeof unavailable>

const toAudioAccess = (
  reply: CreateAudioAccessReply
): Effect.Effect<AudioAccess, AudioAccessFailure> => {
  switch (reply._tag) {
    case "Found":
      return parse(AudioAccessSchema)(reply.access).pipe(
        Effect.mapError(unavailable)
      )
    case "NotFound":
      return Effect.fail(notFound())
    case "Rejected":
      return Effect.fail(unavailable())
  }
}

type FeedSubscription = TypeOf<typeof FeedSubscriptionSchema>
type FeedSubscriptionPage = TypeOf<typeof FeedSubscriptionPageSchema>
type FeedSyncJobPage = TypeOf<typeof FeedSyncJobPageSchema>
type AddSubscriptionFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unprocessable>
  | ReturnType<typeof unavailable>
type ListSubscriptionsFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unavailable>
type ListSyncJobsFailure = ListSubscriptionsFailure
type DeleteSubscriptionFailure =
  | ReturnType<typeof badRequest>
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof subscriptionNotFound>
  | ReturnType<typeof unavailable>

const toAddedSubscription = (
  reply: AddFeedSubscriptionReply
): Effect.Effect<FeedSubscription, AddSubscriptionFailure> => {
  if (reply._tag === "Added")
    return parse(FeedSubscriptionSchema)({
      id: reply.subscription.subscriptionId,
      feedId: reply.subscription.feedId,
      enabled: reply.subscription.enabled,
      createdAt: reply.subscription.createdAt,
    }).pipe(Effect.mapError(unavailable))
  if (reply.code === "INVALID_REQUEST") return Effect.fail(unprocessable())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  return Effect.fail(unavailable())
}

const toSubscriptionPage = (
  reply: ListFeedSubscriptionsReply
): Effect.Effect<FeedSubscriptionPage, ListSubscriptionsFailure> => {
  if (reply._tag === "Listed")
    return parse(FeedSubscriptionPageSchema)({
      items: reply.subscriptions.map((subscription) => ({
        id: subscription.subscriptionId,
        feedId: subscription.feedId,
        enabled: subscription.enabled,
        createdAt: subscription.createdAt,
      })),
      page: { hasMore: false },
    }).pipe(Effect.mapError(unavailable))
  return reply.code === "UNAUTHENTICATED"
    ? Effect.fail(unauthorized())
    : Effect.fail(unavailable())
}

const toSyncJobStatus = {
  Queued: "queued",
  Processing: "processing",
  Succeeded: "succeeded",
  Failed: "failed",
} as const

const toSyncJobPage = (
  reply: ListFeedSyncJobsReply
): Effect.Effect<FeedSyncJobPage, ListSyncJobsFailure> => {
  if (reply._tag !== "Listed") {
    return reply.code === "UNAUTHENTICATED"
      ? Effect.fail(unauthorized())
      : Effect.fail(unavailable())
  }

  return parse(FeedSyncJobPageSchema)({
    items: reply.jobs.map((job) => ({
      jobId: job.jobId,
      feedId: job.feedId,
      feedUrl: job.feedUrl,
      status: toSyncJobStatus[job.status],
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      discovered: job.discovered,
      archived: job.archived,
      failed: job.failed,
      createdAt: job.createdAt,
      ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
      ...(job.completedAt === undefined
        ? {}
        : { completedAt: job.completedAt }),
      ...(job.error === undefined ? {} : { error: job.error }),
    })),
    page: { hasMore: false },
  }).pipe(Effect.mapError(unavailable))
}

const toDeleted = (
  reply: DeleteFeedSubscriptionReply
): Effect.Effect<void, DeleteSubscriptionFailure> => {
  if (reply._tag === "Deleted") return Effect.void
  if (reply._tag === "NotFound") return Effect.fail(subscriptionNotFound())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  if (reply.code === "INVALID_REQUEST") return Effect.fail(badRequest())
  if (reply.code === "NOT_FOUND") return Effect.fail(subscriptionNotFound())
  return Effect.fail(unavailable())
}

const jobNotFound = () =>
  deepFreeze({
    type: "about:blank",
    title: "Episode job not found",
    status: 404 as const,
    code: "episode_job_not_found",
  })
const jobConflict = (code: string) =>
  deepFreeze({
    type: "about:blank",
    title: "Episode job state conflict",
    status: 409 as const,
    code: code.toLowerCase(),
  })

const stateTimestamp = (job: ParsedProductionJob) => {
  switch (job.status) {
    case "queued":
      return job.enqueuedAt
    case "running":
      return job.startedAt
    case "retrying":
      return job.retryAt
    case "succeeded":
      return job.completedAt
    case "failed":
      return job.failedAt
    case "canceled":
      return job.canceledAt
  }
}

const toEpisodeJob = (
  job: ParsedProductionJob
): Effect.Effect<PublicEpisodeJob, ReturnType<typeof unavailable>> =>
  parse(EpisodeJobSchema)({
    id: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    ...(job.articleIds === undefined ? {} : { articleIds: job.articleIds }),
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...(job.status === "running" ? { startedAt: job.startedAt } : {}),
    ...(job.status === "retrying" ? { nextAttemptAt: job.retryAt } : {}),
    ...(["succeeded", "failed", "canceled"].includes(job.status)
      ? { finishedAt: stateTimestamp(job) }
      : {}),
    ...(job.status === "succeeded" ? { episodeId: job.episodeId } : {}),
    ...(job.status === "retrying" || job.status === "failed"
      ? {
          failure: {
            code: job.failure.code,
            message: job.failure.code,
            retryable: job.failure.retryable,
          },
        }
      : {}),
  }).pipe(Effect.mapError(unavailable))

const requireFoundJob = (
  reply: ParsedControlReply
): Effect.Effect<
  PublicEpisodeJob,
  ReturnType<typeof unavailable> | ReturnType<typeof jobNotFound>
> => {
  if (reply._tag === "Found") return toEpisodeJob(reply.job)
  if (reply._tag === "NotFound") return Effect.fail(jobNotFound())
  return Effect.fail(unavailable())
}

const requireMutatedJob = (
  reply: ParsedControlReply,
  tag: "Canceled" | "Retried"
): Effect.Effect<
  PublicEpisodeJob,
  | ReturnType<typeof unavailable>
  | ReturnType<typeof jobNotFound>
  | ReturnType<typeof jobConflict>
> => {
  if (reply._tag === tag) return toEpisodeJob(reply.job)
  if (reply._tag === "NotFound") return Effect.fail(jobNotFound())
  if (reply._tag === "Conflict") return Effect.fail(jobConflict(reply.code))
  return Effect.fail(unavailable())
}

const toEpisode = (
  reply: ParsedGetEpisodeReply
): Effect.Effect<
  PublicEpisode,
  ReturnType<typeof unavailable> | ReturnType<typeof notFound>
> => {
  if (reply._tag === "Found")
    return parse(EpisodeSchema)(reply.episode).pipe(
      Effect.mapError(unavailable)
    )
  if (reply._tag === "NotFound") return Effect.fail(notFound())
  return Effect.fail(unavailable())
}

const toPublicQueueItem = (
  item: {
    readonly articleId: string
    readonly reason: "New" | "Reprocess"
    readonly status: "Queued" | "Processing" | "Succeeded" | "Failed"
  } & Readonly<Record<string, unknown>>
) => {
  const { articleId, ...rest } = item
  return {
    ...rest,
    feedItemId: articleId,
    reason: item.reason.toLowerCase(),
    status: item.status.toLowerCase(),
  }
}

type Dependencies = Readonly<{
  nextMessageId: () => string
  now: () => string
}>

type RequestLineage = Readonly<{
  messageId: string
  correlationId: string
  causationId: string
  remoteTraceparent: string | undefined
}>

type AdapterOptions = Readonly<{
  requestTimeoutMillis: number
  loginMethods: { readonly development: boolean; readonly google: boolean }
}>

const decodeJson = (data: Uint8Array) =>
  Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(data)),
    catch: unavailable,
  })

const makeAdapter = (
  client: UnsafeNatsRequestClient,
  dependencies: Dependencies,
  options: AdapterOptions
): GatewayPorts => {
  const send = (
    subject: string,
    actor: TypeOf<typeof ActorSchema>,
    payload: unknown,
    lineage: RequestLineage
  ) => {
    const operation = Effect.currentSpan.pipe(
      Effect.flatMap((span) =>
        parse(MessageEnvelopeSchema)({
          messageId: lineage.messageId,
          correlationId: lineage.correlationId,
          causationId: lineage.causationId,
          occurredAt: dependencies.now(),
          producer: "gateway",
          traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
          actor,
          payload,
        })
      ),
      Effect.flatMap((envelope) =>
        Schema.encodeEffect(MessageEnvelopeSchema)(envelope)
      ),
      Effect.map((encoded) =>
        new TextEncoder().encode(JSON.stringify(encoded))
      ),
      Effect.flatMap((encoded) =>
        Effect.tryPromise({
          try: () =>
            client.request(subject, encoded, options.requestTimeoutMillis),
          catch: unavailable,
        })
      ),
      Effect.mapError(unavailable)
    )
    const traced = withMessagingSpan(operation, subject, "publish")
    return lineage.remoteTraceparent === undefined
      ? traced
      : withRemoteTraceparent(traced, lineage.remoteTraceparent)
  }

  const receive = (
    data: Uint8Array,
    subject: string,
    expectedProducer: string,
    lineage: RequestLineage
  ) =>
    decodeJson(data).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.flatMap((reply) => {
        const verify = Effect.filterOrFail(
          Effect.succeed(reply),
          (candidate) =>
            candidate.producer === expectedProducer &&
            candidate.correlationId === lineage.correlationId &&
            candidate.causationId === lineage.messageId,
          unavailable
        )
        return withRemoteTraceparent(
          withMessagingSpan(verify, subject, "receive"),
          reply.traceparent
        )
      }),
      Effect.mapError(unavailable)
    )

  const rpc = (
    subject: string,
    expectedProducer: string,
    actor: TypeOf<typeof ActorSchema>,
    payload: unknown,
    lineage: RequestLineage
  ) =>
    send(subject, actor, payload, lineage).pipe(
      Effect.flatMap((reply) =>
        receive(reply, subject, expectedProducer, lineage)
      )
    )

  const resolveActor = (headers: TypeOf<typeof SessionHeadersSchema>) => {
    const messageId = dependencies.nextMessageId()
    const lineage: RequestLineage = {
      messageId,
      correlationId: messageId,
      causationId: messageId,
      remoteTraceparent: headers.traceparent,
    }
    const headerPairs = [
      ...(headers.authorization
        ? [{ name: "authorization", value: headers.authorization }]
        : []),
      ...(headers.cookie ? [{ name: "cookie", value: headers.cookie }] : []),
    ]

    return rpc(
      subjects.identity.resolveSession,
      "identity-access",
      { _tag: "Anonymous" },
      { headers: headerPairs },
      lineage
    ).pipe(
      Effect.flatMap((reply) => parse(SessionReplySchema)(reply.payload)),
      Effect.mapError(unavailable),
      Effect.map(({ actor }) => deepFreeze({ actor, lineage }))
    )
  }

  const authenticated = (headers: TypeOf<typeof SessionHeadersSchema>) =>
    resolveActor(headers).pipe(
      Effect.flatMap(({ actor, lineage }) =>
        actor._tag === "User"
          ? Effect.succeed(deepFreeze({ actor, lineage }))
          : Effect.fail(unauthorized())
      )
    )

  const childLineage = (
    parent: RequestLineage,
    messageId: string
  ): RequestLineage => ({
    messageId,
    correlationId: parent.correlationId,
    causationId: parent.messageId,
    remoteTraceparent: parent.remoteTraceparent,
  })

  const ownerRpc = <Value>(
    headers: TypeOf<typeof SessionHeadersSchema>,
    subject: string,
    producer: string,
    payload: unknown,
    decode: (value: unknown) => Effect.Effect<Value, unknown, never>
  ) =>
    authenticated(headers).pipe(
      Effect.flatMap(({ actor, lineage: parent }) => {
        const lineage = childLineage(parent, dependencies.nextMessageId())
        return rpc(subject, producer, actor, payload, lineage).pipe(
          Effect.flatMap((reply) => decode(reply.payload)),
          Effect.mapError(unavailable)
        )
      })
    )

  return deepFreeze({
    health: () => Effect.succeed(deepFreeze({ status: "ok" as const })),
    resolveSession: (headers) =>
      resolveActor(headers).pipe(
        Effect.map(({ actor }) =>
          actor._tag === "User"
            ? deepFreeze({
                authenticated: true as const,
                userId: actor.userId,
                loginMethods: options.loginMethods,
              })
            : deepFreeze({
                authenticated: false as const,
                loginMethods: options.loginMethods,
              })
        ),
        Effect.flatMap(parse(SessionResponseSchema)),
        Effect.mapError(unavailable)
      ),
    createEpisodeJob: ({ headers, payload }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return send(
            subjects.production.createJob,
            actor,
            {
              idempotencyKey: headers["idempotency-key"],
              trigger: payload.trigger,
              ...(payload.articleIds === undefined
                ? {}
                : { articleIds: payload.articleIds }),
            },
            lineage
          ).pipe(
            Effect.flatMap(decodeJson),
            Effect.flatMap(parse(ProductionCreateEpisodeJobResponseSchema)),
            Effect.filterOrFail(
              (reply) => reply.correlationId === lineage.correlationId,
              unavailable
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap((reply) =>
          reply._tag === "Accepted"
            ? parse(JobReceiptSchema)({
                id: reply.jobId,
                status: "queued",
                createdAt: dependencies.now(),
                attempt: 0,
                maxAttempts: 4,
              }).pipe(Effect.mapError(unavailable))
            : Effect.fail(
                reply.code === "IDEMPOTENCY_CONFLICT"
                  ? conflict()
                  : unavailable()
              )
        )
      ),
    listEpisodeJobs: ({ headers, limit }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.production.listJobs,
            "episode-production",
            actor,
            { ...(limit === undefined ? {} : { limit }) },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseEpisodeJobControlReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap((reply) =>
          reply._tag === "Listed"
            ? Effect.forEach(reply.jobs, toEpisodeJob).pipe(
                Effect.flatMap((items) =>
                  parse(EpisodeJobPageSchema)({
                    items,
                    page: { hasMore: false },
                  })
                ),
                Effect.mapError(unavailable)
              )
            : Effect.fail(unavailable())
        )
      ),
    getEpisodeJob: ({ headers, jobId }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.production.getJob,
            "episode-production",
            actor,
            { jobId },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseEpisodeJobControlReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(requireFoundJob)
      ),
    cancelEpisodeJob: ({ headers, jobId }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.production.cancelJob,
            "episode-production",
            actor,
            { jobId },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseEpisodeJobControlReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap((reply) => requireMutatedJob(reply, "Canceled"))
      ),
    retryEpisodeJob: ({ headers, jobId, idempotencyKey }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.production.retryJob,
            "episode-production",
            actor,
            { jobId, idempotencyKey },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseEpisodeJobControlReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap((reply) => requireMutatedJob(reply, "Retried")),
        Effect.flatMap((job) =>
          parse(JobReceiptSchema)({
            id: job.id,
            status: job.status,
            createdAt: job.createdAt,
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
          }).pipe(Effect.mapError(unavailable))
        )
      ),
    replayEpisodeJobEvents: ({ headers, jobId, afterSequence }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const requestControl = (subject: string, payload: unknown) => {
            const lineage = childLineage(parent, dependencies.nextMessageId())
            return rpc(
              subject,
              "episode-production",
              actor,
              payload,
              lineage
            ).pipe(
              Effect.flatMap((reply) =>
                parseEpisodeJobControlReply(reply.payload)
              ),
              Effect.mapError(unavailable)
            )
          }
          return Effect.all([
            requestControl(subjects.production.getJob, { jobId }),
            requestControl(subjects.production.listJobEvents, {
              jobId,
              afterSequence,
              limit: 100,
            }),
          ])
        }),
        Effect.flatMap(([current, replay]) =>
          Effect.all({
            snapshot: requireFoundJob(current),
            events:
              replay._tag === "Events"
                ? Effect.forEach(replay.events, ({ sequence, job }) =>
                    toEpisodeJob(job).pipe(
                      Effect.map((projected) => ({ sequence, job: projected }))
                    )
                  )
                : replay._tag === "NotFound"
                  ? Effect.fail(jobNotFound())
                  : Effect.fail(unavailable()),
          })
        ),
        Effect.map(deepFreeze)
      ),
    listEpisodes: ({ headers, cursor }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.library.listEpisodes,
            "episode-library",
            actor,
            { ...(cursor === undefined ? {} : { cursor }) },
            lineage
          ).pipe(
            Effect.flatMap((reply) => parseListEpisodesReply(reply.payload)),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap((reply) =>
          reply._tag === "Listed"
            ? parse(EpisodePageSchema)(reply.page).pipe(
                Effect.mapError(unavailable)
              )
            : Effect.fail(unavailable())
        )
      ),
    getEpisode: ({ headers, episodeId }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.library.getEpisode,
            "episode-library",
            actor,
            { episodeId },
            lineage
          ).pipe(
            Effect.flatMap((reply) => parseGetEpisodeReply(reply.payload)),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(toEpisode)
      ),
    createAudioAccess: ({ headers, episodeId }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.library.createAudioAccess,
            "episode-library",
            actor,
            { episodeId },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseCreateAudioAccessReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(toAudioAccess)
      ),
    addFeedSubscription: ({ headers, payload }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.content.addSubscription,
            "content-knowledge",
            actor,
            payload,
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseAddFeedSubscriptionReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(toAddedSubscription)
      ),
    listFeedSubscriptions: (headers) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.content.listSubscriptions,
            "content-knowledge",
            actor,
            {},
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseListFeedSubscriptionsReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(toSubscriptionPage)
      ),
    listFeedSyncJobs: (headers) =>
      ownerRpc(
        headers,
        subjects.content.listFeedSyncJobs,
        "content-knowledge",
        {},
        parseListFeedSyncJobsReply
      ).pipe(Effect.flatMap(toSyncJobPage)),
    deleteFeedSubscription: ({ headers, subscriptionId }) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.content.deleteSubscription,
            "content-knowledge",
            actor,
            { subscriptionId },
            lineage
          ).pipe(
            Effect.flatMap((reply) =>
              parseDeleteFeedSubscriptionReply(reply.payload)
            ),
            Effect.mapError(unavailable)
          )
        }),
        Effect.flatMap(toDeleted)
      ),
    ...({
      updateFeedSubscription: ({
        headers,
        subscriptionId,
        payload,
      }: Parameters<GatewayPorts["updateFeedSubscription"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.updateSubscription,
          "content-knowledge",
          {
            subscriptionId,
            enabled: payload.enabled,
          },
          parseUpdateFeedSubscriptionReply
        ).pipe(
          Effect.flatMap(
            (
              reply
            ): Effect.Effect<
              Schema.Schema.Type<typeof UpdatedFeedSubscriptionSchema>,
              | ReturnType<typeof subscriptionNotFound>
              | ReturnType<typeof unavailable>
            > =>
              reply._tag === "Updated"
                ? parse(UpdatedFeedSubscriptionSchema)({
                    id: reply.subscription.subscriptionId,
                    feedId: reply.subscription.feedId,
                    createdAt: reply.subscription.createdAt,
                    enabled: reply.enabled,
                  }).pipe(Effect.mapError(unavailable))
                : reply._tag === "NotFound"
                  ? Effect.fail(subscriptionNotFound())
                  : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      listFeeds: ({ headers, q }: Parameters<GatewayPorts["listFeeds"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.listFeedCatalog,
          "content-knowledge",
          {
            ...(q === undefined ? {} : { q }),
          },
          parseListFeedCatalogReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Catalog"
              ? parse(FeedPageSchema)({
                  items: reply.feeds.map((feed) => ({
                    id: feed.feedId,
                    name: new URL(feed.feedUrl).hostname,
                    siteUrl: new URL("/", feed.feedUrl).href,
                    feedUrl: feed.feedUrl,
                  })),
                  page: { hasMore: false },
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      registerFeed: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["registerFeed"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.addSubscription,
          "content-knowledge",
          payload,
          parseAddFeedSubscriptionReply
        ).pipe(
          Effect.flatMap(
            (
              reply
            ): Effect.Effect<
              Schema.Schema.Type<typeof RegisteredFeedSchema>,
              | ReturnType<typeof unauthorized>
              | ReturnType<typeof unprocessable>
              | ReturnType<typeof unavailable>
            > =>
              reply._tag === "Added"
                ? parse(RegisteredFeedSchema)({
                    feed: {
                      id: reply.subscription.feedId,
                      name: new URL(reply.subscription.feedUrl).hostname,
                      siteUrl: new URL("/", reply.subscription.feedUrl).href,
                      feedUrl: reply.subscription.feedUrl,
                    },
                    subscription: {
                      id: reply.subscription.subscriptionId,
                      feedId: reply.subscription.feedId,
                      enabled: reply.subscription.enabled,
                      createdAt: reply.subscription.createdAt,
                    },
                  }).pipe(Effect.mapError(unavailable))
                : reply.code === "UNAUTHENTICATED"
                  ? Effect.fail(unauthorized())
                  : reply.code === "INVALID_REQUEST"
                    ? Effect.fail(unprocessable())
                    : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
    } as unknown as Pick<
      GatewayPorts,
      "updateFeedSubscription" | "listFeeds" | "registerFeed"
    >),
    ...({
      listArticles: ({
        headers,
        query,
      }: Parameters<GatewayPorts["listArticles"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          {
            operation: "List",
            query: {
              limit: query.limit ?? 50,
              state:
                query.state === undefined
                  ? "All"
                  : (
                      {
                        all: "All",
                        unread: "Unread",
                        saved: "Saved",
                        later: "Later",
                      } as const
                    )[query.state],
              includeHidden: query.includeHidden ?? false,
              feedIds: query.feedIds ?? [],
              ...(query.q === undefined ? {} : { q: query.q }),
              order: query.sort === "oldest" ? "Oldest" : "Newest",
            },
          },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Listed"
              ? Effect.forEach(reply.articles, toPublicArticle).pipe(
                  Effect.flatMap((items) =>
                    parse(ArticlePageSchema)({
                      items,
                      page: { hasMore: false },
                    }).pipe(Effect.mapError(unavailable))
                  )
                )
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      getArticle: ({
        headers,
        articleId,
      }: Parameters<GatewayPorts["getArticle"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          { operation: "Find", articleId },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Found"
              ? toPublicArticle(reply.article)
              : Effect.fail(articleReplyFailure(reply))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      getArticleMarkdown: ({
        headers,
        articleId,
      }: Parameters<GatewayPorts["getArticleMarkdown"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          { operation: "Markdown", articleId },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Markdown"
              ? parse(ArticleMarkdownSchema)({
                  markdown: reply.markdown,
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(articleReplyFailure(reply))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      patchArticle: ({
        headers,
        articleId,
        payload,
      }: Parameters<GatewayPorts["patchArticle"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          { operation: "Patch", articleId, patch: payload },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Updated"
              ? toPublicArticle(reply.article)
              : Effect.fail(articleReplyFailure(reply))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      bulkPatchArticles: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["bulkPatchArticles"]>[0]) => {
        const { read, saved, readLater, hidden, ...filter } = payload
        return ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          {
            operation: "BulkPatch",
            query: {
              state:
                filter.state === undefined
                  ? "All"
                  : (
                      {
                        all: "All",
                        unread: "Unread",
                        saved: "Saved",
                        later: "Later",
                      } as const
                    )[filter.state],
              includeHidden: filter.includeHidden ?? false,
              feedIds: filter.feedIds ?? [],
              ...(filter.q === undefined ? {} : { q: filter.q }),
            },
            patch: {
              ...(read === undefined ? {} : { read }),
              ...(saved === undefined ? {} : { saved }),
              ...(readLater === undefined ? {} : { readLater }),
              ...(hidden === undefined ? {} : { hidden }),
            },
          },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "BulkUpdated"
              ? parse(BulkArticleStateResultSchema)({
                  updated: reply.updated,
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        )
      },
      getArticleFacets: ({
        headers,
        query,
      }: Parameters<GatewayPorts["getArticleFacets"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          {
            operation: "Facets",
            query: {
              includeHidden: query.includeHidden ?? false,
              feedIds: query.feedIds ?? [],
              ...(query.q === undefined ? {} : { q: query.q }),
            },
          },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Facets"
              ? parse(ArticleFacetsSchema)({
                  ...reply.facets,
                  feeds: reply.facets.feeds.map((feed) => ({
                    ...feed,
                    name: feed.feedId,
                  })),
                  aiPending: 0,
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      archiveArticle: ({
        headers,
        articleId,
      }: Parameters<GatewayPorts["archiveArticle"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.articleLibrary,
          "content-knowledge",
          { operation: "Archive", articleId },
          parseArticleLibraryReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "ArchiveTriggered"
              ? parse(ArticleArchiveResultSchema)({
                  status:
                    reply.status === "Archived"
                      ? "archived"
                      : "already_archived",
                }).pipe(Effect.mapError(unavailable))
              : Effect.fail(articleReplyFailure(reply))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      listArticleTags: ({
        headers,
        articleId,
      }: Parameters<GatewayPorts["listArticleTags"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          {
            operation: "ListArticleTags",
            articleId,
          },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap(
            (
              reply
            ): Effect.Effect<
              PublicArticleTags,
              | ReturnType<typeof articleNotFound>
              | ReturnType<typeof unavailable>
            > =>
              reply._tag === "ArticleTags"
                ? parse(ArticleTagsSchema)({
                    items: reply.tags.map((tag) => ({
                      ...tag,
                      source: tag.source === "Manual" ? "manual" : "ai",
                    })),
                  }).pipe(Effect.mapError(unavailable))
                : reply._tag === "NotFound"
                  ? Effect.fail(articleNotFound())
                  : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      setArticleTags: ({
        headers,
        articleId,
        payload,
      }: Parameters<GatewayPorts["setArticleTags"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          {
            operation: "SetArticleTags",
            articleId,
            tagIds: payload.tagIds,
          },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap(
            (
              reply
            ): Effect.Effect<
              PublicArticleTags,
              | ReturnType<typeof articleNotFound>
              | ReturnType<typeof personalizationConflict>
              | ReturnType<typeof unavailable>
            > =>
              reply._tag === "ArticleTags"
                ? parse(ArticleTagsSchema)({
                    items: reply.tags.map((tag) => ({
                      ...tag,
                      source: tag.source === "Manual" ? "manual" : "ai",
                    })),
                  }).pipe(Effect.mapError(unavailable))
                : reply._tag === "NotFound"
                  ? Effect.fail(articleNotFound())
                  : reply._tag === "Conflict"
                    ? Effect.fail(personalizationConflict())
                    : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      enrichArticle: ({
        headers,
        articleId,
      }: Parameters<GatewayPorts["enrichArticle"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          {
            operation: "EnrichArticle",
            articleId,
          },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap(
            (
              reply
            ): Effect.Effect<
              PublicEnrichmentEnqueued,
              | ReturnType<typeof articleNotFound>
              | ReturnType<typeof personalizationConflict>
              | ReturnType<typeof unavailable>
            > =>
              reply._tag === "Enqueued"
                ? parse(EnrichmentEnqueuedSchema)({
                    enqueued: reply.count,
                  }).pipe(Effect.mapError(unavailable))
                : reply._tag === "NotFound"
                  ? Effect.fail(articleNotFound())
                  : reply._tag === "Conflict"
                    ? Effect.fail(personalizationConflict())
                    : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
    } as unknown as Pick<
      GatewayPorts,
      | "listArticles"
      | "getArticle"
      | "getArticleMarkdown"
      | "patchArticle"
      | "bulkPatchArticles"
      | "getArticleFacets"
      | "archiveArticle"
      | "listArticleTags"
      | "setArticleTags"
      | "enrichArticle"
    >),
    ...({
      listAgentInstances: (
        headers: Parameters<GatewayPorts["listAgentInstances"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "ListInstances" },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Instances"
              ? parse(AgentInstancePageSchema)({ items: reply.instances }).pipe(
                  Effect.mapError(agentUnavailable)
                )
              : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      getAgentRun: ({
        headers,
        runId,
      }: Parameters<GatewayPorts["getAgentRun"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "GetRun", runId },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Run"
              ? parse(AgentRunSchema)(reply.run).pipe(
                  Effect.mapError(agentUnavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      replayAgentRunEvents: ({
        headers,
        runId,
        afterSequence,
      }: Parameters<GatewayPorts["replayAgentRunEvents"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "ReplayEvents", runId, afterSequence, limit: 100 },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Events"
              ? Effect.forEach(reply.events, (event) =>
                  parse(AgentRunEventSchema)(event).pipe(
                    Effect.mapError(agentUnavailable)
                  )
                )
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      listAgentMemories: ({
        headers,
        agentInstanceId,
      }: Parameters<GatewayPorts["listAgentMemories"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "ListMemories", agentInstanceId },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Memories"
              ? parse(AgentMemoryPageSchema)({ items: reply.memories }).pipe(
                  Effect.mapError(agentUnavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      createAgentMemory: ({
        headers,
        agentInstanceId,
        payload,
      }: Parameters<GatewayPorts["createAgentMemory"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "CreateMemory", agentInstanceId, ...payload },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Memory"
              ? parse(AgentMemorySchema)(reply.memory).pipe(
                  Effect.mapError(agentUnavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      approveAgentMemory: ({
        headers,
        agentInstanceId,
        memoryId,
      }: Parameters<GatewayPorts["approveAgentMemory"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "ApproveMemory", agentInstanceId, memoryId },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Memory"
              ? parse(AgentMemorySchema)(reply.memory).pipe(
                  Effect.mapError(agentUnavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(agentConflict())
                  : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
      deleteAgentMemory: ({
        headers,
        agentInstanceId,
        memoryId,
      }: Parameters<GatewayPorts["deleteAgentMemory"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.agentAuditMemory,
          "episode-production",
          { operation: "DeleteMemory", agentInstanceId, memoryId },
          parseAgentAuditReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Deleted"
              ? Effect.void
              : reply._tag === "NotFound"
                ? Effect.fail(agentNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(agentConflict())
                  : Effect.fail(agentUnavailable())
          ),
          Effect.mapError(agentUnavailable)
        ),
    } as unknown as Pick<
      GatewayPorts,
      | "listAgentInstances"
      | "getAgentRun"
      | "replayAgentRunEvents"
      | "listAgentMemories"
      | "createAgentMemory"
      | "approveAgentMemory"
      | "deleteAgentMemory"
    >),
    ...({
      getSettings: (headers: Parameters<GatewayPorts["getSettings"]>[0]) =>
        Effect.all([
          ownerRpc(
            headers,
            subjects.identity.getGenerationSettings,
            "identity-access",
            { operation: "Get" },
            parseIdentitySettingsReply
          ),
          ownerRpc(
            headers,
            subjects.content.personalization,
            "content-knowledge",
            { operation: "GetInterestProfile" },
            parseContentPersonalizationReply
          ),
        ]).pipe(
          Effect.flatMap(([identity, content]) =>
            (identity._tag === "Settings" && content._tag === "InterestProfile"
              ? parse(UserSettingsSchema)({
                  generationSchedule: identity.generationSchedule,
                  interestProfile: content.interestProfile,
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      updateSettings: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["updateSettings"]>[0]) =>
        Effect.all([
          payload.generationSchedule === undefined
            ? ownerRpc(
                headers,
                subjects.identity.getGenerationSettings,
                "identity-access",
                { operation: "Get" },
                parseIdentitySettingsReply
              )
            : ownerRpc(
                headers,
                subjects.identity.updateGenerationSettings,
                "identity-access",
                {
                  operation: "Update",
                  generationSchedule: payload.generationSchedule,
                },
                parseIdentitySettingsReply
              ),
          payload.interestProfile === undefined
            ? ownerRpc(
                headers,
                subjects.content.personalization,
                "content-knowledge",
                { operation: "GetInterestProfile" },
                parseContentPersonalizationReply
              )
            : ownerRpc(
                headers,
                subjects.content.personalization,
                "content-knowledge",
                {
                  operation: "UpdateInterestProfile",
                  interestProfile: payload.interestProfile,
                },
                parseContentPersonalizationReply
              ),
        ]).pipe(
          Effect.flatMap(([identity, content]) =>
            (identity._tag === "Settings" && content._tag === "InterestProfile"
              ? parse(UserSettingsSchema)({
                  generationSchedule: identity.generationSchedule,
                  interestProfile: content.interestProfile,
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      listTags: (headers: Parameters<GatewayPorts["listTags"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "ListTags" },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Tags"
              ? parse(TagPageSchema)({
                  items: reply.tags.map((tag) => ({
                    id: tag.tagId,
                    name: tag.name,
                    createdAt: tag.createdAt,
                  })),
                  page: { hasMore: false },
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      createTag: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["createTag"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "CreateTag", name: payload.name },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Tag"
              ? parse(TagSchema)({
                  id: reply.tag.tagId,
                  name: reply.tag.name,
                  createdAt: reply.tag.createdAt,
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      deleteTag: ({
        headers,
        tagId,
      }: Parameters<GatewayPorts["deleteTag"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "DeleteTag", tagId },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Deleted"
              ? Effect.void
              : reply._tag === "NotFound"
                ? Effect.fail(personalizationNotFound())
                : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      listTagSuggestions: (
        headers: Parameters<GatewayPorts["listTagSuggestions"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "ListTagSuggestions" },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Suggestions"
              ? parse(TagSuggestionPageSchema)({
                  items: reply.suggestions,
                  page: { hasMore: false },
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      promoteTagSuggestion: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["promoteTagSuggestion"]>[0]) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "PromoteTagSuggestion", name: payload.name },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Tag"
              ? parse(TagSchema)({
                  id: reply.tag.tagId,
                  name: reply.tag.name,
                  createdAt: reply.tag.createdAt,
                })
              : reply._tag === "NotFound"
                ? Effect.fail(personalizationNotFound())
                : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      listReadingDictionary: (
        headers: Parameters<GatewayPorts["listReadingDictionary"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.production.readingDictionary,
          "episode-production",
          { operation: "List" },
          parseReadingDictionaryReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Entries"
              ? parse(ReadingDictionaryPageSchema)({
                  items: reply.entries,
                  page: { hasMore: false },
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      createReadingDictionary: ({
        headers,
        payload,
      }: Parameters<GatewayPorts["createReadingDictionary"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.readingDictionary,
          "episode-production",
          { operation: "Create", ...payload },
          parseReadingDictionaryReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Entry"
              ? parse(ReadingDictionaryEntrySchema)(reply.entry)
              : reply._tag === "Conflict"
                ? Effect.fail(personalizationConflict())
                : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      updateReadingDictionary: ({
        headers,
        id,
        payload,
      }: Parameters<GatewayPorts["updateReadingDictionary"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.readingDictionary,
          "episode-production",
          { operation: "Update", id, patch: payload },
          parseReadingDictionaryReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Entry"
              ? parse(ReadingDictionaryEntrySchema)(reply.entry)
              : reply._tag === "NotFound"
                ? Effect.fail(personalizationNotFound())
                : reply._tag === "Conflict"
                  ? Effect.fail(personalizationConflict())
                  : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      deleteReadingDictionary: ({
        headers,
        id,
      }: Parameters<GatewayPorts["deleteReadingDictionary"]>[0]) =>
        ownerRpc(
          headers,
          subjects.production.readingDictionary,
          "episode-production",
          { operation: "Delete", id },
          parseReadingDictionaryReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "Deleted"
              ? Effect.void
              : reply._tag === "NotFound"
                ? Effect.fail(personalizationNotFound())
                : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      getEnrichQueue: (
        headers: Parameters<GatewayPorts["getEnrichQueue"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "GetEnrichmentQueue" },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            (reply._tag === "EnrichmentQueue"
              ? parse(EnrichQueueSchema)({
                  ...reply.queue,
                  processing: reply.queue.processing.map(toPublicQueueItem),
                  pending: {
                    ...reply.queue.pending,
                    items: reply.queue.pending.items.map(toPublicQueueItem),
                  },
                  failed: {
                    ...reply.queue.failed,
                    items: reply.queue.failed.items.map(toPublicQueueItem),
                  },
                  recent: reply.queue.recent.map(toPublicQueueItem),
                })
              : Effect.fail(unavailable())
            ).pipe(Effect.mapError(normalizePersonalizationFailure))
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      enrichReprocess: (
        headers: Parameters<GatewayPorts["enrichReprocess"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          { operation: "ReprocessEnrichment" },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Enqueued"
              ? Effect.succeed(deepFreeze({ enqueued: reply.count }))
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
      enrichResetDaily: (
        headers: Parameters<GatewayPorts["enrichResetDaily"]>[0]
      ) =>
        ownerRpc(
          headers,
          subjects.content.personalization,
          "content-knowledge",
          {
            operation: "ResetDailyEnrichment",
            localDate: dependencies.now().slice(0, 10),
          },
          parseContentPersonalizationReply
        ).pipe(
          Effect.flatMap((reply) =>
            reply._tag === "Reset"
              ? Effect.succeed(
                  deepFreeze({
                    message: "Daily enrichment usage reset" as const,
                  })
                )
              : Effect.fail(unavailable())
          ),
          Effect.mapError(normalizePersonalizationFailure)
        ),
    } as unknown as Pick<
      GatewayPorts,
      | "getSettings"
      | "updateSettings"
      | "listTags"
      | "createTag"
      | "deleteTag"
      | "listTagSuggestions"
      | "promoteTagSuggestion"
      | "listReadingDictionary"
      | "createReadingDictionary"
      | "updateReadingDictionary"
      | "deleteReadingDictionary"
      | "getEnrichQueue"
      | "enrichReprocess"
      | "enrichResetDaily"
    >),
  } satisfies GatewayPorts)
}

export const makeNatsGatewayPorts = (
  client: UnsafeNatsRequestClient,
  dependencies: Dependencies
): GatewayPorts =>
  makeAdapter(client, dependencies, {
    requestTimeoutMillis: 2_000,
    loginMethods: { development: false, google: true },
  })

export const acquireNatsGatewayPorts = (
  config: Readonly<{
    natsServers: readonly string[]
    requestTimeoutMillis: number
    loginMethods: { readonly development: boolean; readonly google: boolean }
  }>,
  dependencies: Dependencies & {
    connect?: (servers: readonly string[]) => Promise<UnsafeNatsRequestClient>
  } = {
    nextMessageId: randomUuidUnsafe,
    now: currentUtcInstantUnsafe,
  }
): Effect.Effect<GatewayPorts, unknown, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        (dependencies.connect ?? connectNatsRequestClientUnsafe)(
          config.natsServers
        ),
      catch: unavailable,
    }),
    (client) => Effect.promise(() => client.drain()).pipe(Effect.ignore)
  ).pipe(Effect.map((client) => makeAdapter(client, dependencies, config)))
