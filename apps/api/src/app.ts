import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"
import { streamSSE } from "hono/streaming"
import {
  encodeSse,
  toAgUiEvents,
  type EpisodeJobState,
} from "@news-podcast/contracts/agui"
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
  ArticleArchiveStatusSchema,
  ArticleFacetsSchema,
  ArticleSchema,
  BulkArticleStateResultSchema,
  FeedSchema,
  IdSchema,
  InterestProfileSchema,
  JobReceiptSchema,
  JobSchema,
  jsonContent,
  MAX_SELECTED_ARTICLES,
  page,
  problemContent,
  ScheduleSchema,
  SettingsSchema,
  SubscriptionSchema,
  TagNameSchema,
  TagSchema,
  TagSuggestionSchema,
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
    readonly articleIds?: readonly string[]
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
  // AI補助（要約+スコア）のオンデマンド再計算。falseはアーカイブ未完了などの対象外。
  readonly enrichArticle?: (
    ownerId: string,
    articleId: string
  ) => Promise<boolean>
}

const unavailable = () =>
  problem(503, "service-unavailable", "Service unavailable")

const JOB_STREAM_POLL_MS = 500
const JOB_STREAM_HEARTBEAT_MS = 15_000
/** ジョブ自体の上限30分より長くしておき、正常終了を打ち切らないようにする。 */
const JOB_STREAM_MAX_MS = 35 * 60_000
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "canceled"])

function toJobStateSnapshot(job: JobDto): EpisodeJobState {
  return {
    jobId: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    // 履歴は後続のイベント再生で積み上がるので、ここでは空から始める。
    adoptedArticles: [],
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.stageProgress ? { progress: job.stageProgress } : {}),
    ...(job.failure
      ? { failure: { code: job.failure.code, message: job.failure.message } }
      : {}),
    ...(job.episodeId ? { episodeId: job.episodeId } : {}),
  }
}

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
    if (context.req.path.startsWith("/v1/telemetry/")) return next()
    const startedAt = performance.now()
    const parent = requestTraceContext(context.req.raw.headers)
    await observability.withSpan(
      "http.request",
      { "http.request.method": context.req.method },
      async () => {
        try {
          await next()
        } finally {
          observability.log({
            name: "api.request",
            attributes: {
              "http.request.method": context.req.method,
              "http.response.status_code": context.res.status,
            },
            level: context.res.status >= 500 ? "error" : "info",
          })
          observability.measure(
            "http.server.duration",
            performance.now() - startedAt
          )
        }
      },
      parent ? { parent } : undefined
    )
  })

  app.use("/v1/*", async (context, next) => {
    if (context.req.path.startsWith("/v1/audio/")) return next()
    let ownerId: string | null
    try {
      ownerId = dependencies.resolveOwner
        ? await dependencies.resolveOwner(context.req.raw)
        : null
    } catch {
      return context.json(unavailable(), 503)
    }
    if (!ownerId) {
      return context.json(problem(401, "unauthorized", "Unauthorized"), 401)
    }
    context.set("ownerId", ownerId)
    return next()
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
    const query = context.req.valid("query")
    const result = dependencies.store.listArticles(context.get("ownerId"), {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      ...(query.q ? { q: query.q } : {}),
      state: query.state,
      ...(query.feedIds ? { feedIds: query.feedIds } : {}),
      sort: query.sort,
      ...(query.includeHidden !== undefined
        ? { includeHidden: query.includeHidden }
        : {}),
      ...(query.usedInEpisode !== undefined
        ? { usedInEpisode: query.usedInEpisode }
        : {}),
      ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
      ...(query.publishedAfter ? { publishedAfter: query.publishedAfter } : {}),
      ...(query.publishedBefore
        ? { publishedBefore: query.publishedBefore }
        : {}),
      ...(query.archiveStatus ? { archiveStatus: query.archiveStatus } : {}),
      ...(query.tagIds ? { tagIds: query.tagIds } : {}),
    })
    return context.json(
      {
        items: result.items.map(articleResponse),
        page: {
          hasMore: result.hasMore,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
      200
    )
  })

  app.openapi(articleFacetsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const query = context.req.valid("query")
    const facets = dependencies.store.listArticleFacets(
      context.get("ownerId"),
      {
        ...(query.q ? { q: query.q } : {}),
        ...(query.feedIds ? { feedIds: query.feedIds } : {}),
        ...(query.includeHidden !== undefined
          ? { includeHidden: query.includeHidden }
          : {}),
        ...(query.publishedAfter
          ? { publishedAfter: query.publishedAfter }
          : {}),
        ...(query.publishedBefore
          ? { publishedBefore: query.publishedBefore }
          : {}),
        ...(query.archiveStatus ? { archiveStatus: query.archiveStatus } : {}),
        ...(query.tagIds ? { tagIds: query.tagIds } : {}),
      }
    )
    return context.json(facets, 200)
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

  app.openapi(bulkArticleStateRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const body = context.req.valid("json")
    const updated = dependencies.store.bulkSetArticleState(
      context.get("ownerId"),
      {
        ...(body.q ? { q: body.q } : {}),
        ...(body.state ? { state: body.state } : {}),
        ...(body.feedIds ? { feedIds: body.feedIds } : {}),
        ...(body.includeHidden !== undefined
          ? { includeHidden: body.includeHidden }
          : {}),
        ...(body.publishedAfter ? { publishedAfter: body.publishedAfter } : {}),
        ...(body.publishedBefore
          ? { publishedBefore: body.publishedBefore }
          : {}),
        ...(body.archiveStatus ? { archiveStatus: body.archiveStatus } : {}),
      },
      {
        ...(body.read !== undefined ? { read: body.read } : {}),
        ...(body.saved !== undefined ? { saved: body.saved } : {}),
        ...(body.readLater !== undefined ? { readLater: body.readLater } : {}),
        ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      }
    )
    return context.json({ updated }, 200)
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
  app.openapi(enrichArticleRoute, async (context) => {
    if (!dependencies.store || !dependencies.enrichArticle) {
      return context.json(unavailable(), 503)
    }
    const ownerId = context.get("ownerId")
    const articleId = context.req.valid("param").articleId
    const article = dependencies.store.getArticle(ownerId, articleId)
    if (!article)
      return context.json(problem(404, "not-found", "Not found"), 404)
    let recomputed: boolean
    try {
      recomputed = await dependencies.enrichArticle(ownerId, articleId)
    } catch {
      return context.json(unavailable(), 503)
    }
    if (!recomputed) {
      return context.json(
        problem(409, "article-not-archived", "Article is not archived yet"),
        409
      )
    }
    const refreshed = dependencies.store.getArticle(ownerId, articleId)
    return refreshed
      ? context.json(articleResponse(refreshed), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })
  app.openapi(articleAssetRoute, (context) =>
    dependencies.serveArticleAsset
      ? dependencies.serveArticleAsset(
          context.get("ownerId"),
          context.req.valid("param").articleId,
          context.req.valid("param").hash
        )
      : context.json(unavailable(), 503)
  )

  app.openapi(putArticleTagsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const ownerId = context.get("ownerId")
    const articleId = context.req.valid("param").articleId
    if (!dependencies.store.getArticle(ownerId, articleId)) {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
    dependencies.store.setArticleManualTags(
      ownerId,
      articleId,
      context.req.valid("json").tagIds
    )
    const article = dependencies.store.getArticle(ownerId, articleId)
    return article
      ? context.json(articleResponse(article), 200)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(listTagsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store.listTags(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(createTagRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const tag = dependencies.store.createTag(
      context.get("ownerId"),
      context.req.valid("json").name
    )
    context.header("Location", `/v1/me/tags/${tag.id}`)
    return context.json(tag, 201)
  })

  app.openapi(deleteTagRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return dependencies.store.deleteTag(
      context.get("ownerId"),
      context.req.valid("param").tagId
    )
      ? context.body(null, 204)
      : context.json(problem(404, "not-found", "Not found"), 404)
  })

  app.openapi(listTagSuggestionsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    return context.json(
      {
        items: dependencies.store.listTagSuggestions(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })

  app.openapi(promoteTagSuggestionRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const tag = dependencies.store.promoteTagSuggestion(
      context.get("ownerId"),
      context.req.valid("json").name
    )
    if (!tag) return context.json(problem(404, "not-found", "Not found"), 404)
    context.header("Location", `/v1/me/tags/${tag.id}`)
    return context.json(tag, 201)
  })

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
    const ownerId = context.get("ownerId")
    return context.json(
      {
        generationSchedule: dependencies.store.getSettings(ownerId),
        interestProfile: dependencies.store.getInterestProfile(ownerId),
      },
      200
    )
  })

  app.openapi(patchSettingsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const ownerId = context.get("ownerId")
    const body = context.req.valid("json")
    if (body.generationSchedule) {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: body.generationSchedule.timeZone,
        }).format()
      } catch {
        return context.json(
          problem(400, "invalid-time-zone", "Invalid time zone"),
          400
        )
      }
      dependencies.store.setSettings(ownerId, body.generationSchedule)
    }
    if (body.interestProfile) {
      dependencies.store.setInterestProfile(ownerId, body.interestProfile)
    }
    return context.json(
      {
        generationSchedule: dependencies.store.getSettings(ownerId),
        interestProfile: dependencies.store.getInterestProfile(ownerId),
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
    const ownerId = context.get("ownerId")
    const articleIds: readonly string[] | undefined =
      context.req.valid("json").articleIds
    if (articleIds && dependencies.store) {
      // 他人の記事・購読停止中のフィード・アーカイブ未完了の記事を弾く。
      // エージェントは選択記事しか読めないので、ここを通すと必ず失敗する。
      const selectable = new Set(
        dependencies.store.filterSelectableArticleIds(ownerId, articleIds)
      )
      const rejected = articleIds.filter((id) => !selectable.has(id))
      if (rejected.length > 0) {
        return context.json(
          problem(
            422,
            "unselectable-articles",
            `Not available for generation: ${rejected.join(", ")}`
          ),
          422
        )
      }
    }
    try {
      const traceContext = observability.captureContext()
      const job = await dependencies.createEpisodeJob({
        ownerId,
        idempotencyKey: context.req.valid("header")["Idempotency-Key"],
        ...(articleIds ? { articleIds } : {}),
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
          maxAttempts: job.maxAttempts,
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
    observability.count("episode.canceled")
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
        maxAttempts: job.maxAttempts,
      },
      202
    )
  })

  app.openapi(jobEventsRoute, (context) => {
    const store = dependencies.store
    if (!store) return context.json(unavailable(), 503)
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const job = store.getJob(ownerId, jobId)
    if (!job) return context.json(problem(404, "not-found", "Not found"), 404)

    // EventSource は Last-Event-ID ヘッダを、fetch ベースのクライアントは
    // どちらでも送れる。ヘッダを優先する。
    const headerId = Number(context.req.valid("header")["Last-Event-ID"])
    const resumeFrom = Number.isFinite(headerId)
      ? headerId
      : (context.req.valid("query").lastEventId ?? 0)

    return streamSSE(context, async (stream) => {
      let aborted = false
      stream.onAbort(() => {
        aborted = true
      })
      let cursor = resumeFrom
      let lastWriteAt = Date.now()
      const write = async (chunk: string) => {
        await stream.write(chunk)
        lastWriteAt = Date.now()
      }

      // 再開時にスナップショットを送ると、クライアントが積み上げた
      // adoptedArticles を空で上書きしてしまう。新規接続のときだけ送る。
      if (cursor === 0) {
        await write(
          encodeSse({
            event: {
              type: "STATE_SNAPSHOT",
              timestamp: Date.now(),
              snapshot: toJobStateSnapshot(job),
            },
          })
        )
      }

      const startedAt = Date.now()
      while (!aborted && Date.now() - startedAt < JOB_STREAM_MAX_MS) {
        const rows = store.listJobEventsAfter({
          ownerId,
          jobId,
          afterSequence: cursor,
        })
        for (const row of rows) {
          for (const event of toAgUiEvents(jobId, row)) {
            await write(encodeSse({ id: row.sequence, event }))
          }
          cursor = row.sequence
        }
        // 残イベントを流し切ってから終端を判定する。順序を逆にすると
        // 最後の RUN_FINISHED を送る前に閉じてしまう。
        const current = store.getJob(ownerId, jobId)
        if (
          rows.length === 0 &&
          (!current || TERMINAL_JOB_STATUSES.has(current.status))
        ) {
          return
        }
        if (Date.now() - lastWriteAt >= JOB_STREAM_HEARTBEAT_MS) {
          await write(": heartbeat\n\n")
        }
        await stream.sleep(JOB_STREAM_POLL_MS)
      }
    })
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

function requestTraceContext(headers: Headers): TraceContext | undefined {
  const traceParent = headers.get("traceparent")
  if (!traceParent) return undefined
  const traceState = headers.get("tracestate")
  return {
    traceParent,
    ...(traceState ? { traceState } : {}),
  }
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
    {
      name: "Tags",
      description: "Owner-defined tag vocabulary and AI tag suggestions",
    },
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

// 単一値/複数値どちらでも渡せるクエリパラメータを配列へ正規化する。
// Honoは同名クエリが1つだけの場合は文字列、複数の場合は配列で渡す。
const toQueryArray = (value: unknown) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value]

// 期間絞り込み。publishedAfter/publishedBeforeともに境界値を含む閉区間として扱う
// （両方指定時、逆転していれば422）。判定対象はソート基準と揃えたCOALESCE(published_at, discovered_at)。
const publishedRangeFields = {
  publishedAfter: z.iso.datetime().optional(),
  publishedBefore: z.iso.datetime().optional(),
}
const publishedRangeValid = (value: {
  readonly publishedAfter?: string
  readonly publishedBefore?: string
}) =>
  !value.publishedAfter ||
  !value.publishedBefore ||
  value.publishedAfter <= value.publishedBefore
const publishedRangeRefinement = {
  message: "publishedAfter must not be after publishedBefore",
  path: ["publishedBefore"],
}

const listArticlesQuery = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    q: z.string().min(1).max(200).optional(),
    state: z.enum(["all", "unread", "saved", "later"]).default("all"),
    feedIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
    sort: z.enum(["newest", "oldest", "source", "relevance"]).default("newest"),
    includeHidden: z.stringbool().optional(),
    usedInEpisode: z.stringbool().optional(),
    // sort=relevance以外でも使える。未処理（スコア無し）記事は満たさない扱い。
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    ...publishedRangeFields,
    archiveStatus: z
      .preprocess(toQueryArray, z.array(ArticleArchiveStatusSchema))
      .optional(),
    // 指定時、いずれかのタグが付いている記事のみ返す（OR条件）。
    tagIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
  })
  .refine(publishedRangeValid, publishedRangeRefinement)

const listArticlesRoute = createRoute({
  method: "get",
  path: "/v1/me/articles",
  tags: ["Articles"],
  operationId: "listArticles",
  description: "List articles from the authenticated owner's subscriptions.",
  request: { query: listArticlesQuery },
  responses: {
    200: jsonContent(page(ArticleSchema), "Articles"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const articleFacetsQuery = z
  .object({
    q: z.string().min(1).max(200).optional(),
    feedIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
    includeHidden: z.stringbool().optional(),
    ...publishedRangeFields,
    archiveStatus: z
      .preprocess(toQueryArray, z.array(ArticleArchiveStatusSchema))
      .optional(),
    tagIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
  })
  .refine(publishedRangeValid, publishedRangeRefinement)

const articleFacetsRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/facets",
  tags: ["Articles"],
  operationId: "getArticleFacets",
  description:
    "Return state and per-feed counts for the current search/filter scope.",
  request: { query: articleFacetsQuery },
  responses: {
    200: jsonContent(ArticleFacetsSchema, "Article facets"),
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

const articleStateBody = z.object({
  read: z.boolean().optional(),
  saved: z.boolean().optional(),
  readLater: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

const hasAnyArticleStateFlag = (value: {
  read?: boolean
  saved?: boolean
  readLater?: boolean
  hidden?: boolean
}) =>
  value.read !== undefined ||
  value.saved !== undefined ||
  value.readLater !== undefined ||
  value.hidden !== undefined

const patchArticleRoute = createRoute({
  method: "patch",
  path: "/v1/me/articles/{articleId}",
  tags: ["Articles"],
  operationId: "updateArticleState",
  description:
    "Update read, saved, readLater, or hidden state for one article.",
  request: {
    params: articleParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: articleStateBody.refine(hasAnyArticleStateFlag),
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

const bulkArticleStateBody = z
  .object({
    q: z.string().min(1).max(200).optional(),
    state: z.enum(["all", "unread", "saved", "later"]).optional(),
    feedIds: z.array(IdSchema).optional(),
    includeHidden: z.boolean().optional(),
    ...publishedRangeFields,
    archiveStatus: z.array(ArticleArchiveStatusSchema).optional(),
  })
  .extend(articleStateBody.shape)
  .refine(hasAnyArticleStateFlag)
  .refine(publishedRangeValid, publishedRangeRefinement)

const bulkArticleStateRoute = createRoute({
  method: "post",
  path: "/v1/me/articles/bulk-state",
  tags: ["Articles"],
  operationId: "bulkUpdateArticleState",
  description:
    "Apply read/saved/readLater/hidden state to every article matching a filter (e.g. mark all as read).",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkArticleStateBody } },
    },
  },
  responses: {
    200: jsonContent(
      BulkArticleStateResultSchema,
      "Number of articles updated"
    ),
    401: problemContent("Unauthorized"),
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

const enrichArticleRoute = createRoute({
  method: "post",
  path: "/v1/me/articles/{articleId}/enrich",
  tags: ["Articles"],
  operationId: "enrichArticle",
  description:
    "Recompute the AI summary and relevance score for one article on demand.",
  request: { params: articleParams },
  responses: {
    200: jsonContent(ArticleSchema, "Recomputed"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Article is not archived yet"),
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

// PUT /articles/{id}/tags: 記事の手動タグ集合を丸ごと置き換える。AI付与タグは別枠で維持される
// （LocalStore.setArticleManualTagsを参照）。
const putArticleTagsRoute = createRoute({
  method: "put",
  path: "/v1/me/articles/{articleId}/tags",
  tags: ["Articles"],
  operationId: "setArticleTags",
  description: "Replace the manual tag set for one article.",
  request: {
    params: articleParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ tagIds: z.array(IdSchema) }) },
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

const tagParams = z.object({
  tagId: IdSchema.openapi({ param: { name: "tagId", in: "path" } }),
})

const listTagsRoute = createRoute({
  method: "get",
  path: "/v1/me/tags",
  tags: ["Tags"],
  operationId: "listTags",
  description:
    "List the authenticated owner's tag vocabulary (used both for manual tagging and as the AI candidate set).",
  responses: {
    200: jsonContent(page(TagSchema), "Tags"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const createTagRoute = createRoute({
  method: "post",
  path: "/v1/me/tags",
  tags: ["Tags"],
  operationId: "createTag",
  description: "Add a tag to the owner's vocabulary (idempotent by name).",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ name: TagNameSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(TagSchema, "Created"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const deleteTagRoute = createRoute({
  method: "delete",
  path: "/v1/me/tags/{tagId}",
  tags: ["Tags"],
  operationId: "deleteTag",
  description: "Remove one tag from the owner's vocabulary.",
  request: { params: tagParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

const listTagSuggestionsRoute = createRoute({
  method: "get",
  path: "/v1/me/tag-suggestions",
  tags: ["Tags"],
  operationId: "listTagSuggestions",
  description:
    "List AI-proposed tag names that fell outside the owner's vocabulary, most frequent first.",
  responses: {
    200: jsonContent(page(TagSuggestionSchema), "Tag suggestions"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

const promoteTagSuggestionRoute = createRoute({
  method: "post",
  path: "/v1/me/tag-suggestions/promote",
  tags: ["Tags"],
  operationId: "promoteTagSuggestion",
  description:
    "Turn a suggested tag name into a real vocabulary tag and remove the suggestion.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ name: TagNameSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(TagSchema, "Promoted"),
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
  description:
    "Return the authenticated owner's generation schedule and interest profile.",
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
  description:
    "Update the authenticated owner's generation schedule and/or interest profile.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            generationSchedule: ScheduleSchema.optional(),
            interestProfile: InterestProfileSchema.optional(),
          }),
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
          schema: z.object({
            trigger: z.literal("manual"),
            articleIds: z
              .array(IdSchema)
              .min(1)
              .max(MAX_SELECTED_ARTICLES)
              .optional()
              .openapi({
                description:
                  "Restrict the episode to these archived articles. Omit for fully automatic selection.",
              }),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonContent(JobReceiptSchema, "Accepted"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    409: problemContent("Conflict"),
    422: problemContent("Unselectable articles"),
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

const jobEventsRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs/{jobId}/events",
  tags: ["Episode jobs"],
  operationId: "streamEpisodeJobEvents",
  description:
    "Stream generation progress as AG-UI events over SSE. The first event is always STATE_SNAPSHOT; pass Last-Event-ID to resume without gaps or duplicates.",
  request: {
    params: jobParams,
    query: z.object({
      lastEventId: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({ param: { name: "lastEventId", in: "query" } }),
    }),
    headers: z.object({
      "Last-Event-ID": z
        .string()
        .optional()
        .openapi({ param: { name: "Last-Event-ID", in: "header" } }),
    }),
  },
  responses: {
    200: {
      description: "AG-UI event stream",
      content: { "text/event-stream": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
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
  description:
    "Activate a proposed Memory within the same owner and Agent scope.",
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
    ...(memory.expiresAt ? { expiresAt: memory.expiresAt.toISOString() } : {}),
  }
}

function articleResponse(
  article: ReturnType<LocalStore["listArticles"]>["items"][number]
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
