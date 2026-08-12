import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  ActorSchema,
  type AddFeedSubscriptionReply,
  CorrelationIdSchema,
  type DeleteFeedSubscriptionReply,
  type ListFeedSubscriptionsReply,
  type CreateAudioAccessReply,
  MessageEnvelopeSchema,
  parseAddFeedSubscriptionReply,
  parseCreateAudioAccessReply,
  parseDeleteFeedSubscriptionReply,
  parseListEpisodesReply,
  parseListFeedSubscriptionsReply,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema, Scope } from "effect"

import {
  AudioAccessSchema,
  EpisodePageSchema,
  FeedSubscriptionPageSchema,
  FeedSubscriptionSchema,
  JobReceiptSchema,
  SessionResponseSchema,
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

type AudioAccess = TypeOf<typeof AudioAccessSchema>
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
type AddSubscriptionFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unprocessable>
  | ReturnType<typeof unavailable>
type ListSubscriptionsFailure =
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof unavailable>
type DeleteSubscriptionFailure =
  | ReturnType<typeof badRequest>
  | ReturnType<typeof unauthorized>
  | ReturnType<typeof subscriptionNotFound>
  | ReturnType<typeof unavailable>

const toAddedSubscription = (
  reply: AddFeedSubscriptionReply
): Effect.Effect<FeedSubscription, AddSubscriptionFailure> => {
  if (reply._tag === "Added")
    return parse(FeedSubscriptionSchema)(reply.subscription).pipe(
      Effect.mapError(unavailable)
    )
  if (reply.code === "INVALID_REQUEST") return Effect.fail(unprocessable())
  if (reply.code === "UNAUTHENTICATED") return Effect.fail(unauthorized())
  return Effect.fail(unavailable())
}

const toSubscriptionPage = (
  reply: ListFeedSubscriptionsReply
): Effect.Effect<FeedSubscriptionPage, ListSubscriptionsFailure> => {
  if (reply._tag === "Listed")
    return parse(FeedSubscriptionPageSchema)({
      items: reply.subscriptions,
      page: { hasMore: false },
    }).pipe(Effect.mapError(unavailable))
  return reply.code === "UNAUTHENTICATED"
    ? Effect.fail(unauthorized())
    : Effect.fail(unavailable())
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
    listEpisodes: (headers) =>
      authenticated(headers).pipe(
        Effect.flatMap(({ actor, lineage: parent }) => {
          const lineage = childLineage(parent, dependencies.nextMessageId())
          return rpc(
            subjects.library.listEpisodes,
            "episode-library",
            actor,
            {},
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
