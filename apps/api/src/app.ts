import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"

import type { JobDto, LocalStore } from "@news-podcast/adapters/db/local"

import {
  EpisodeSchema,
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

export interface AppDependencies {
  readonly store?: LocalStore
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
  }) => Promise<JobDto>
  readonly issueAudioAccess?: (
    ownerId: string,
    episodeId: string
  ) => Promise<{ url: string; expiresAt: string } | undefined>
  readonly serveAudio?: (token: string, range?: string) => Promise<Response>
}

const unavailable = () =>
  problem(503, "service-unavailable", "Service unavailable")

export function createApp(dependencies: AppDependencies = {}) {
  const app = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json(
            problem(400, "validation-error", "Invalid request"),
            400
          ),
  })

  if (dependencies.authHandler) {
    app.on(["GET", "POST"], "/api/auth/*", (context) =>
      dependencies.authHandler!(context.req.raw)
    )
  }
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

  app.openapi(healthRoute, (context) => context.json({ status: "ok" }, 200))

  app.openapi(listFeedsRoute, (context) => {
    if (!dependencies.store) return context.json(unavailable(), 503)
    const { q } = context.req.valid("query")
    return context.json(
      { items: dependencies.store.listFeeds(q), page: { hasMore: false } },
      200
    )
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
      const job = await dependencies.createEpisodeJob({
        ownerId: context.get("ownerId"),
        idempotencyKey: context.req.valid("header")["Idempotency-Key"],
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
    { name: "Settings", description: "Owner-scoped generation schedule" },
    { name: "Episode jobs", description: "Asynchronous generation jobs" },
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

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint")
}
