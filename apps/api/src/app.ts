import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"
import {
  noopObservability,
  type Observability,
  type TraceContext,
} from "@news-podcast/observability"

import type { JobDto, LocalStore } from "@news-podcast/adapters/db/local"
import type { SqliteAgentRuntimeStore } from "@news-podcast/adapters/agent-runtime/sqlite"
import type {
  AgentMemoryRecord,
  AgentRunRecord,
} from "@news-podcast/application"

import {
  EpisodeSchema,
  AgentEventSchema,
  AgentInstanceSchema,
  AgentMemorySchema,
  AgentRunSchema,
  ArticleSchema,
  FeedSchema,
  IdSchema,
  JobReceiptSchema,
  JobSchema,
  jsonContent,
  page,
  problemContent,
  ScheduleSchema,
  SettingsSchema,
  SubscriptionSchema,
} from "./http/schemas.js"

type Variables = { ownerId: string }
type TelemetrySignal = "logs" | "metrics" | "traces"

export interface AppDependencies {
  readonly store?: LocalStore
  readonly agentRuntimeStore?: SqliteAgentRuntimeStore
  readonly authHandler?: (request: Request) => Response | Promise<Response>
  readonly resolveOwner?: (request: Request) => Promise<string | null>
  readonly devLoginHandler?: (request: Request) => Promise<Response>
  readonly devLogoutHandler?: (request: Request) => Promise<Response>
  readonly loginMethods?: {
    readonly development: boolean
    readonly google: boolean
  }
  readonly createEpisodeJob?: (input: {
    readonly ownerId: string
    readonly idempotencyKey: string
    readonly traceContext?: TraceContext
  }) => Promise<JobDto>
  readonly observability?: Observability
  readonly telemetryOrigin?: string
  readonly forwardTelemetry?: (
    signal: TelemetrySignal,
    body: Uint8Array,
    contentType: string
  ) => Promise<void>
  readonly issueAudioAccess?: (
    ownerId: string,
    episodeId: string
  ) => Promise<{ url: string; expiresAt: string } | undefined>
  readonly serveAudio?: (token: string, range?: string) => Promise<Response>
  readonly discoverFeed?: (
    ownerId: string,
    feedUrl: string
  ) => Promise<{
    readonly feed: {
      id: string
      name: string
      siteUrl: string
      feedUrl: string
    }
    readonly subscription: {
      id: string
      feedId: string
      enabled: boolean
      createdAt: string
    }
  }>
  readonly serveArticleMarkdown?: (
    ownerId: string,
    articleId: string
  ) => Promise<Response>
  readonly serveArticleArchive?: (
    ownerId: string,
    articleId: string
  ) => Promise<Response>
  readonly serveArticleAsset?: (
    ownerId: string,
    articleId: string,
    hash: string
  ) => Promise<Response>
}

const unavailable = () =>
  problem(503, "service-unavailable", "Service unavailable")

export function createApp(dependencies: AppDependencies = {}) {
  const observability = dependencies.observability ?? noopObservability
  const telemetryRequests = new Map<
    string,
    { count: number; resetAt: number }
  >()
  const app = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json(
            problem(400, "validation-error", "Invalid request"),
            400
          ),
  })

  app.post("/api/dev/login", (context) =>
    dependencies.devLoginHandler
      ? dependencies.devLoginHandler(context.req.raw)
      : context.json(unavailable(), 503)
  )
  app.post("/api/dev/logout", (context) =>
    dependencies.devLogoutHandler
      ? dependencies.devLogoutHandler(context.req.raw)
      : context.json(unavailable(), 503)
  )

  app.get("/api/auth/state", async (context) => {
    context.header("Cache-Control", "private, no-store")
    try {
      const ownerId = dependencies.resolveOwner
        ? await dependencies.resolveOwner(context.req.raw)
        : null
      return context.json({
        authenticated: ownerId !== null,
        loginMethods: dependencies.loginMethods ?? {
          development: false,
          google: false,
        },
      })
    } catch {
      return context.json(unavailable(), 503)
    }
  })

  if (dependencies.authHandler) {
    app.on(["GET", "POST"], "/api/auth/*", (context) =>
      dependencies.authHandler!(context.req.raw)
    )
  }

  app.use("/v1/*", async (context, next) => {
    if (context.req.path.startsWith("/v1/audio/")) return next()
    const ownerId = dependencies.resolveOwner
      ? await dependencies.resolveOwner(context.req.raw)
      : null
    if (!ownerId) {
      return context.json(problem(401, "unauthorized", "Unauthorized"), 401)
    }
    context.set("ownerId", ownerId)
    return next()
  })

  app.use("/v1/*", async (context, next) => {
    if (context.req.path.startsWith("/v1/telemetry/")) return next()
    const startedAt = performance.now()
    await observability.withSpan(
      "http.request",
      { "http.request.method": context.req.method },
      next
    )
    observability.log({
      name: "api.request",
      attributes: {
        "http.request.method": context.req.method,
        "http.response.status_code": context.res.status,
      },
      level: context.res.status >= 500 ? "error" : "info",
    })
    observability.measure("http.server.duration", performance.now() - startedAt)
  })

  app.openapi(telemetryRoute, async (context) => {
    if (!dependencies.forwardTelemetry) {
      return context.json(unavailable(), 503)
    }
    const origin = context.req.header("Origin")
    if (!origin || origin !== dependencies.telemetryOrigin) {
      return context.json(problem(403, "forbidden", "Forbidden"), 403)
    }
    const contentType = context.req.header("Content-Type")?.split(";", 1)[0]
    if (
      contentType !== "application/x-protobuf" &&
      contentType !== "application/json"
    ) {
      return context.json(
        problem(415, "unsupported-media-type", "Unsupported media type"),
        415
      )
    }
    const contentLength = Number(context.req.header("Content-Length") ?? "0")
    if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
      return context.json(
        problem(413, "payload-too-large", "Payload too large"),
        413
      )
    }
    if (!consumeTelemetryRequest(telemetryRequests, context.get("ownerId"))) {
      return context.json(problem(429, "rate-limited", "Rate limited"), 429)
    }
    const body = new Uint8Array(await context.req.arrayBuffer())
    if (body.byteLength > 256 * 1024) {
      return context.json(
        problem(413, "payload-too-large", "Payload too large"),
        413
      )
    }
    try {
      await dependencies.forwardTelemetry(
        context.req.valid("param").signal,
        body,
        contentType
      )
      return context.body(null, 204)
    } catch {
      return context.json(unavailable(), 503)
    }
  })

  app.openapi(healthRoute, (context) => context.json({ status: "ok" }, 200))

  app.openapi(listFeedsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const { q } = context.req.valid("query")
    return context.json(
      {
        items: dependencies.store.listVisibleFeeds(context.get("ownerId"), q),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(registerFeedRoute, async (context) => {
    if (!dependencies.discoverFeed) return context.json(unavailable(), 503)
    try {
      const result = await dependencies.discoverFeed(
        context.get("ownerId"),
        context.req.valid("json").feedUrl
      )
      context.header("Location", `/v1/feeds/${result.feed.id}`)
      return context.json(result, 201)
    } catch {
      return context.json(
        problem(422, "feed-discovery-failed", "Feed discovery failed"),
        422
      )
    }
  })

  app.openapi(listArticlesRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store
          .listArticles(context.get("ownerId"))
          .map(articleResponse),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(getArticleRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const article = dependencies.store.getArticle(
      context.get("ownerId"),
      context.req.valid("param").articleId
    )
    return article
      ? context.json(articleResponse(article), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(patchArticleRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const article = dependencies.store.setArticleState(
      context.get("ownerId"),
      context.req.valid("param").articleId,
      context.req.valid("json")
    )
    return article
      ? context.json(articleResponse(article), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(articleMarkdownRoute, (context) =>
    dependencies.serveArticleMarkdown
      ? dependencies.serveArticleMarkdown(
          context.get("ownerId"),
          context.req.valid("param").articleId
        )
      : context.json(unavailable(), 503)
  )
  app.openapi(articleArchiveRoute, (context) =>
    dependencies.serveArticleArchive
      ? dependencies.serveArticleArchive(
          context.get("ownerId"),
          context.req.valid("param").articleId
        )
      : context.json(unavailable(), 503)
  )
  app.openapi(articleAssetRoute, (context) =>
    dependencies.serveArticleAsset
      ? dependencies.serveArticleAsset(
          context.get("ownerId"),
          context.req.valid("param").articleId,
          context.req.valid("param").hash
        )
      : context.json(unavailable(), 503)
  )

  app.openapi(listSubscriptionsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store.listSubscriptions(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(createSubscriptionRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    try {
      const subscription = dependencies.store.createSubscription(
        context.get("ownerId"),
        context.req.valid("json").feedId
      )
      context.header("Location", `/v1/me/feed-subscriptions/${subscription.id}`)
      return context.json(subscription, 201)
    } catch (error) {
      const code = isUniqueConstraint(error)
        ? "subscription-exists"
        : "feed-not-found"
      return context.json(problem(409, code, "Subscription conflict"), 409)
    }
  })

  app.openapi(patchSubscriptionRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const subscription = dependencies.store.setSubscriptionEnabled(
      context.get("ownerId"),
      context.req.valid("param").subscriptionId,
      context.req.valid("json").enabled
    )
    return subscription
      ? context.json(subscription, 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(deleteSubscriptionRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return dependencies.store.deleteSubscription(
      context.get("ownerId"),
      context.req.valid("param").subscriptionId
    )
      ? context.body(null, 204)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(getSettingsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        generationSchedule: dependencies.store.getSettings(
          context.get("ownerId")
        ),
      },
      200
    )
  })

  app.openapi(patchSettingsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const schedule = context.req.valid("json").generationSchedule
    try {
      new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone }).format()
    } catch {
      return context.json(
        problem(400, "invalid-time-zone", "Invalid time zone"),
        400
      )
    }
    return context.json(
      {
        generationSchedule: dependencies.store.setSettings(
          context.get("ownerId"),
          schedule
        ),
      },
      200
    )
  })

  app.openapi(listJobsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store.listJobs(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(createJobRoute, async (context) => {
    if (!dependencies.createEpisodeJob) return context.json(unavailable(), 503)
    try {
      const traceContext = observability.captureContext()
      const job = await dependencies.createEpisodeJob({
        ownerId: context.get("ownerId"),
        idempotencyKey: context.req.valid("header")["Idempotency-Key"],
        ...(traceContext ? { traceContext } : {}),
      })
      observability.count("episode.requested")
      observability.log({
        name: "episode.requested",
        attributes: { trigger: "manual" },
      })
      context.header("Location", `/v1/episode-jobs/${job.id}`)
      context.header(
        "Idempotency-Key",
        context.req.valid("header")["Idempotency-Key"]
      )
      context.header("Retry-After", "2")
      return context.json(
        {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          attempt: job.attempt,
        },
        202
      )
    } catch (error) {
      return context.json(
        problem(409, "idempotency-conflict", String(error)),
        409
      )
    }
  })

  app.openapi(getJobRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const job = dependencies.store.getJob(
      context.get("ownerId"),
      context.req.valid("param").jobId
    )
    return job
      ? context.json(job, 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(cancelJobRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const result = dependencies.store.cancelJob(ownerId, jobId)
    if (result === "not_found") {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
    if (result === "terminal") {
      return context.json(
        problem(409, "job-terminal", "Terminal jobs cannot be canceled"),
        409
      )
    }
    return context.json(dependencies.store.getJob(ownerId, jobId)!, 200)
  })

  app.openapi(retryJobRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const original = dependencies.store.getJob(ownerId, jobId)
    if (!original) {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
    const job = dependencies.store.retryFailedJob(ownerId, jobId)
    if (!job) {
      return context.json(
        problem(409, "job-not-failed", "Only failed jobs can be retried"),
        409
      )
    }
    context.header("Location", `/v1/episode-jobs/${job.id}`)
    context.header("Retry-After", "2")
    return context.json(
      {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        attempt: job.attempt,
      },
      202
    )
  })

  app.openapi(getAgentRunRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    const run = await dependencies.agentRuntimeStore.get(
      context.get("ownerId"),
      context.req.valid("param").runId
    )
    return run
      ? context.json(toAgentRunResponse(run), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(listAgentEventsRoute, (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    const events = dependencies.agentRuntimeStore.listEvents(
      context.get("ownerId"),
      context.req.valid("param").runId
    )
    return events
      ? context.json(
          {
            items: events.map((event) => ({
              ...event,
              occurredAt: event.occurredAt.toISOString(),
            })),
            page: { hasMore: false as const },
          },
          200
        )
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(listAgentInstancesRoute, (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    return context.json(
      {
        items: dependencies.agentRuntimeStore
          .listInstances(context.get("ownerId"))
          .map((instance) => ({
            id: instance.id,
            agentKey: instance.agentKey,
            createdAt: instance.createdAt.toISOString(),
          })),
        page: { hasMore: false as const },
      },
      200
    )
  })

  app.openapi(listAgentMemoriesRoute, (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    return context.json(
      {
        items: dependencies.agentRuntimeStore
          .listMemories(
            context.get("ownerId"),
            context.req.valid("param").agentId
          )
          .map(toAgentMemoryResponse),
        page: { hasMore: false as const },
      },
      200
    )
  })

  app.openapi(createAgentMemoryRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    try {
      const body = context.req.valid("json")
      const memory = await dependencies.agentRuntimeStore.propose({
        ownerId: context.get("ownerId"),
        agentInstanceId: context.req.valid("param").agentId,
        kind: body.kind,
        content: body.content,
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      })
      return context.json(toAgentMemoryResponse(memory), 201)
    } catch {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
  })

  app.openapi(approveAgentMemoryRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    const memory = await dependencies.agentRuntimeStore.decide({
      ownerId: context.get("ownerId"),
      agentInstanceId: context.req.valid("param").agentId,
      memoryId: context.req.valid("param").memoryId,
      decision: "approve",
    })
    return memory
      ? context.json(toAgentMemoryResponse(memory), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(deleteAgentMemoryRoute, (context) => {
    if (!dependencies.agentRuntimeStore) {
      return context.json(unavailable(), 503)
    }
    const deleted = dependencies.agentRuntimeStore.deleteMemory(
      context.get("ownerId"),
      context.req.valid("param").agentId,
      context.req.valid("param").memoryId
    )
    return deleted
      ? context.body(null, 204)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(listEpisodesRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store.listEpisodes(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(getEpisodeRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const episode = dependencies.store.getEpisode(
      context.get("ownerId"),
      context.req.valid("param").episodeId
    )
    return episode
      ? context.json(episode, 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(audioAccessRoute, async (context) => {
    if (!dependencies.issueAudioAccess) return context.json(unavailable(), 503)
    const access = await dependencies.issueAudioAccess(
      context.get("ownerId"),
      context.req.valid("param").episodeId
    )
    if (!access) {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
    context.header("Cache-Control", "private, no-store")
    return context.json(access, 200)
  })

  app.openapi(audioRoute, (context) =>
    dependencies.serveAudio
      ? dependencies.serveAudio(
          context.req.valid("param").token,
          context.req.header("Range")
        )
      : context.json(unavailable(), 503)
  )

  app.doc("/openapi.json", documentConfig)
  return app
}

export const documentConfig = {
  openapi: "3.1.0",
  info: {
    title: "RSS News Podcast API",
    version: "0.2.0",
    description: "Local-first RSS news podcast application contract.",
    contact: { name: "News Podcast maintainers" },
  },
  tags: [
    { name: "System", description: "Runtime health and contract" },
    { name: "Feeds", description: "RSS feed catalog" },
    { name: "Subscriptions", description: "Owner-scoped RSS subscriptions" },
    { name: "Articles", description: "Archived RSS articles and read state" },
    { name: "Settings", description: "Owner-scoped generation schedule" },
    { name: "Episode jobs", description: "Asynchronous generation jobs" },
    { name: "Agent runtime", description: "Agent runs and safe timeline" },
    { name: "Agent memory", description: "Owner-scoped durable Agent memory" },
    { name: "Episodes", description: "Completed episodes and audio access" },
  ],
  servers: [{ url: "http://localhost:4173", description: "Local development" }],
}

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  operationId: "getHealth",
  description: "Return process liveness without credentials.",
  responses: {
    200: jsonContent(z.object({ status: z.literal("ok") }), "Alive"),
  },
})

const telemetryRoute = createRoute({
  method: "post",
  path: "/v1/telemetry/{signal}",
  tags: ["System"],
  operationId: "ingestBrowserTelemetry",
  description: "Forward authenticated same-origin browser OTLP telemetry.",
  request: {
    params: z.object({ signal: z.enum(["logs", "metrics", "traces"]) }),
    body: {
      required: true,
      content: {
        "application/x-protobuf": {
          schema: z.any().openapi({ type: "string", format: "binary" }),
        },
        "application/json": { schema: z.any() },
      },
    },
  },
  responses: {
    204: { description: "Accepted" },
    401: problemContent("Unauthorized"),
    403: problemContent("Forbidden"),
    413: problemContent("Payload too large"),
    415: problemContent("Unsupported media type"),
    429: problemContent("Rate limited"),
    503: problemContent("Unavailable"),
  },
})

function consumeTelemetryRequest(
  requests: Map<string, { count: number; resetAt: number }>,
  ownerId: string,
  now = Date.now()
): boolean {
  const current = requests.get(ownerId)
  if (!current || current.resetAt <= now) {
    requests.set(ownerId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  current.count += 1
  return current.count <= 60
}

const listFeedsRoute = createRoute({
  method: "get",
  path: "/v1/feeds",
  tags: ["Feeds"],
  operationId: "listFeeds",
  description: "Search the configured RSS feed catalog.",
  request: { query: z.object({ q: z.string().min(1).max(200).optional() }) },
  responses: {
    200: jsonContent(page(FeedSchema), "Feed catalog"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const registerFeedRoute = createRoute({
  method: "post",
  path: "/v1/feeds",
  tags: ["Feeds"],
  operationId: "registerFeed",
  description: "Discover, register, and subscribe to an arbitrary RSS URL.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ feedUrl: z.url() }),
        },
      },
    },
  },
  responses: {
    201: jsonContent(
      z.object({ feed: FeedSchema, subscription: SubscriptionSchema }),
      "Registered"
    ),
    401: problemContent("Unauthorized"),
    422: problemContent("Feed discovery failed"),
    503: problemContent("Unavailable"),
  },
})

const articleParams = z.object({
  articleId: IdSchema.openapi({ param: { name: "articleId", in: "path" } }),
})

const listArticlesRoute = createRoute({
  method: "get",
  path: "/v1/me/articles",
  tags: ["Articles"],
  operationId: "listArticles",
  description: "List articles from the authenticated owner's subscriptions.",
  responses: {
    200: jsonContent(page(ArticleSchema), "Articles"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const getArticleRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}",
  tags: ["Articles"],
  operationId: "getArticle",
  description: "Return one owner-scoped article and archive status.",
  request: { params: articleParams },
  responses: {
    200: jsonContent(ArticleSchema, "Article"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const patchArticleRoute = createRoute({
  method: "patch",
  path: "/v1/me/articles/{articleId}",
  tags: ["Articles"],
  operationId: "updateArticleState",
  description: "Update read or saved state for one article.",
  request: {
    params: articleParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              read: z.boolean().optional(),
              saved: z.boolean().optional(),
            })
            .refine(
              (value: { read?: boolean; saved?: boolean }) =>
                value.read !== undefined || value.saved !== undefined
            ),
        },
      },
    },
  },
  responses: {
    200: jsonContent(ArticleSchema, "Updated"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const articleMarkdownRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/markdown",
  tags: ["Articles"],
  operationId: "getArticleMarkdown",
  description: "Return the archived Markdown used by the Podcast Agent.",
  request: { params: articleParams },
  responses: {
    200: {
      description: "Archived article Markdown",
      content: { "text/markdown": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const articleArchiveRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/archive",
  tags: ["Articles"],
  operationId: "getArticleArchive",
  description: "Return sanitized replay HTML with external scripts disabled.",
  request: { params: articleParams },
  responses: {
    200: {
      description: "Sanitized replay HTML",
      content: { "text/html": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const articleAssetRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/assets/{hash}",
  tags: ["Articles"],
  operationId: "getArticleAsset",
  description:
    "Return one owner-scoped asset captured with an article snapshot.",
  request: {
    params: articleParams.extend({
      hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .openapi({ param: { name: "hash", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "Archived asset",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const listSubscriptionsRoute = createRoute({
  method: "get",
  path: "/v1/me/feed-subscriptions",
  tags: ["Subscriptions"],
  operationId: "listSubscriptions",
  description: "List the authenticated owner's feed subscriptions.",
  responses: {
    200: jsonContent(page(SubscriptionSchema), "Subscriptions"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const createSubscriptionRoute = createRoute({
  method: "post",
  path: "/v1/me/feed-subscriptions",
  tags: ["Subscriptions"],
  operationId: "createSubscription",
  description: "Subscribe the authenticated owner to a catalog feed.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ feedId: IdSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(SubscriptionSchema, "Created"),
    401: problemContent("Unauthorized"),
    409: problemContent("Conflict"),
    503: problemContent("Unavailable"),
  },
})

const subscriptionParams = z.object({
  subscriptionId: IdSchema.openapi({
    param: { name: "subscriptionId", in: "path" },
  }),
})

const patchSubscriptionRoute = createRoute({
  method: "patch",
  path: "/v1/me/feed-subscriptions/{subscriptionId}",
  tags: ["Subscriptions"],
  operationId: "updateSubscription",
  description: "Enable or pause one owner-scoped subscription.",
  request: {
    params: subscriptionParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ enabled: z.boolean() }) },
      },
    },
  },
  responses: {
    200: jsonContent(SubscriptionSchema, "Updated"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const deleteSubscriptionRoute = createRoute({
  method: "delete",
  path: "/v1/me/feed-subscriptions/{subscriptionId}",
  tags: ["Subscriptions"],
  operationId: "deleteSubscription",
  description: "Delete one owner-scoped subscription.",
  request: { params: subscriptionParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const getSettingsRoute = createRoute({
  method: "get",
  path: "/v1/me/settings",
  tags: ["Settings"],
  operationId: "getSettings",
  description: "Return the authenticated owner's generation schedule.",
  responses: {
    200: jsonContent(SettingsSchema, "Settings"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const patchSettingsRoute = createRoute({
  method: "patch",
  path: "/v1/me/settings",
  tags: ["Settings"],
  operationId: "updateSettings",
  description: "Update the authenticated owner's generation schedule.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ generationSchedule: ScheduleSchema }),
        },
      },
    },
  },
  responses: {
    200: jsonContent(SettingsSchema, "Updated"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const listJobsRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs",
  tags: ["Episode jobs"],
  operationId: "listEpisodeJobs",
  description: "List recent generation jobs for the authenticated owner.",
  responses: {
    200: jsonContent(page(JobSchema), "Jobs"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const createJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs",
  tags: ["Episode jobs"],
  operationId: "createEpisodeJob",
  description: "Create an idempotent asynchronous episode generation job.",
  request: {
    headers: z.object({
      "Idempotency-Key": z
        .string()
        .min(1)
        .max(255)
        .openapi({
          param: { name: "Idempotency-Key", in: "header" },
        }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ trigger: z.literal("manual") }),
        },
      },
    },
  },
  responses: {
    202: jsonContent(JobReceiptSchema, "Accepted"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    409: problemContent("Conflict"),
    503: problemContent("Unavailable"),
  },
})

const jobParams = z.object({
  jobId: IdSchema.openapi({ param: { name: "jobId", in: "path" } }),
})
const getJobRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs/{jobId}",
  tags: ["Episode jobs"],
  operationId: "getEpisodeJob",
  description: "Return progress and retry state for one generation job.",
  request: { params: jobParams },
  responses: {
    200: jsonContent(JobSchema, "Job"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const cancelJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs/{jobId}/cancel",
  tags: ["Episode jobs"],
  operationId: "cancelEpisodeJob",
  description:
    "Cancel queued, running, or retrying work and stop its active sandbox session.",
  request: { params: jobParams },
  responses: {
    200: jsonContent(JobSchema, "Canceled"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Already terminal"),
    503: problemContent("Unavailable"),
  },
})

const retryJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs/{jobId}/retry",
  tags: ["Episode jobs"],
  operationId: "retryEpisodeJob",
  description:
    "Create a new job from a failed job's feed, Memory, and policy snapshots.",
  request: { params: jobParams },
  responses: {
    202: jsonContent(JobReceiptSchema, "Accepted"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Job is not failed"),
    503: problemContent("Unavailable"),
  },
})

const runParams = z.object({
  runId: IdSchema.openapi({ param: { name: "runId", in: "path" } }),
})

const getAgentRunRoute = createRoute({
  method: "get",
  path: "/v1/agent-runs/{runId}",
  tags: ["Agent runtime"],
  operationId: "getAgentRun",
  description: "Return one owner-scoped Agent run without private reasoning.",
  request: { params: runParams },
  responses: {
    200: jsonContent(AgentRunSchema, "Agent run"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const listAgentEventsRoute = createRoute({
  method: "get",
  path: "/v1/agent-runs/{runId}/events",
  tags: ["Agent runtime"],
  operationId: "listAgentRunEvents",
  description: "List the sanitized, versioned event timeline for an Agent run.",
  request: { params: runParams },
  responses: {
    200: jsonContent(page(AgentEventSchema), "Agent events"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const listAgentInstancesRoute = createRoute({
  method: "get",
  path: "/v1/agent-instances",
  tags: ["Agent memory"],
  operationId: "listAgentInstances",
  description: "List durable Agent instances owned by the authenticated user.",
  responses: {
    200: jsonContent(page(AgentInstanceSchema), "Agent instances"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const agentParams = z.object({
  agentId: IdSchema.openapi({ param: { name: "agentId", in: "path" } }),
})
const memoryParams = agentParams.extend({
  memoryId: IdSchema.openapi({ param: { name: "memoryId", in: "path" } }),
})
const memoryInput = z.object({
  kind: z.enum(["preference", "working_note"]),
  content: z.record(z.string(), z.unknown()),
  expiresAt: z.iso.datetime().optional(),
})

const listAgentMemoriesRoute = createRoute({
  method: "get",
  path: "/v1/agent-instances/{agentId}/memories",
  tags: ["Agent memory"],
  operationId: "listAgentMemories",
  description: "List non-deleted Memory entries for one owned Agent instance.",
  request: { params: agentParams },
  responses: {
    200: jsonContent(page(AgentMemorySchema), "Agent memories"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const createAgentMemoryRoute = createRoute({
  method: "post",
  path: "/v1/agent-instances/{agentId}/memories",
  tags: ["Agent memory"],
  operationId: "createAgentMemory",
  description: "Propose a preference or working note for later approval.",
  request: {
    params: agentParams,
    body: {
      required: true,
      content: { "application/json": { schema: memoryInput } },
    },
  },
  responses: {
    201: jsonContent(AgentMemorySchema, "Memory proposal"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const approveAgentMemoryRoute = createRoute({
  method: "post",
  path: "/v1/agent-instances/{agentId}/memories/{memoryId}/approve",
  tags: ["Agent memory"],
  operationId: "approveAgentMemory",
  description: "Activate a proposed Memory within the same owner and Agent scope.",
  request: { params: memoryParams },
  responses: {
    200: jsonContent(AgentMemorySchema, "Approved memory"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const deleteAgentMemoryRoute = createRoute({
  method: "delete",
  path: "/v1/agent-instances/{agentId}/memories/{memoryId}",
  tags: ["Agent memory"],
  operationId: "deleteAgentMemory",
  description: "Soft-delete a Memory within the same owner and Agent scope.",
  request: { params: memoryParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const listEpisodesRoute = createRoute({
  method: "get",
  path: "/v1/episodes",
  tags: ["Episodes"],
  operationId: "listEpisodes",
  description: "List completed episodes for the authenticated owner.",
  responses: {
    200: jsonContent(page(EpisodeSchema), "Episodes"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const episodeParams = z.object({
  episodeId: IdSchema.openapi({ param: { name: "episodeId", in: "path" } }),
})
const getEpisodeRoute = createRoute({
  method: "get",
  path: "/v1/episodes/{episodeId}",
  tags: ["Episodes"],
  operationId: "getEpisode",
  description: "Return one completed episode with its sources.",
  request: { params: episodeParams },
  responses: {
    200: jsonContent(EpisodeSchema, "Episode"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const audioAccessRoute = createRoute({
  method: "post",
  path: "/v1/episodes/{episodeId}/audio-access",
  tags: ["Episodes"],
  operationId: "createAudioAccess",
  description: "Issue a short-lived owner-scoped audio URL.",
  request: { params: episodeParams },
  responses: {
    200: jsonContent(
      z.object({ url: z.url(), expiresAt: z.iso.datetime() }),
      "Short-lived audio access"
    ),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const audioRoute = createRoute({
  method: "get",
  path: "/v1/audio/{token}",
  tags: ["Episodes"],
  operationId: "getEpisodeAudio",
  description: "Stream WAV audio using a short-lived signed token and Range.",
  request: {
    params: z.object({
      token: z
        .string()
        .min(20)
        .openapi({ param: { name: "token", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "WAV audio",
      content: { "audio/wav": { schema: z.string() } },
    },
    206: {
      description: "Partial WAV audio",
      content: { "audio/wav": { schema: z.string() } },
    },
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

function problem(status: number, code: string, title: string) {
  return {
    type: `https://news-podcast.example/problems/${code}`,
    title,
    status,
    code,
  }
}

function toAgentRunResponse(run: AgentRunRecord) {
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    policyHash: run.policyHash,
    createdAt: run.createdAt.toISOString(),
  }
}

function toAgentMemoryResponse(memory: AgentMemoryRecord) {
  return {
    id: memory.id,
    agentInstanceId: memory.agentInstanceId,
    kind: memory.kind,
    status: memory.status,
    version: memory.version,
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    ...(memory.expiresAt
      ? { expiresAt: memory.expiresAt.toISOString() }
      : {}),
  }
}

function articleResponse(
  article: ReturnType<LocalStore["listArticles"]>[number]
) {
  return {
    ...article,
    ...(article.snapshotId
      ? {
          archiveUrl: `/v1/me/articles/${article.id}/archive`,
          markdownUrl: `/v1/me/articles/${article.id}/markdown`,
        }
      : {}),
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint")
}
