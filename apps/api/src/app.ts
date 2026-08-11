import { OpenAPIHono } from "@hono/zod-openapi"
import { noopObservability } from "@news-podcast/observability"

import type { AppDependencies } from "./dependencies.js"
import type { ApiApp, Variables } from "./http/context.js"
import { problem } from "./http/problem.js"
import { authenticationMiddleware } from "./http/middleware/authentication.js"
import { observabilityMiddleware } from "./http/middleware/observability.js"
import { registerUnversionedRoutes, registerV1Routes } from "./routes/index.js"

export type { AppDependencies } from "./dependencies.js"

/**
 * APIを組み立てる。振る舞いは registrar 群（routes/）に委ね、ここでは
 * ミドルウェアの適用順序と、開発ログイン等の非バージョン管理ルートを
 * /v1ミドルウェアより前に登録することだけを保証する。
 */
export function createApp(dependencies: AppDependencies = {}): ApiApp {
  const observability = dependencies.observability ?? noopObservability
  const app: ApiApp = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json(
            problem(400, "validation-error", "Invalid request"),
            400
          ),
  })

  registerUnversionedRoutes(app, dependencies)

  app.use("/v1/*", observabilityMiddleware(observability))
  app.use("/v1/*", authenticationMiddleware(dependencies.resolveOwner))

  registerV1Routes(app, dependencies)

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
    {
      name: "Tags",
      description: "Owner-defined tag vocabulary and AI tag suggestions",
    },
    { name: "Settings", description: "Owner-scoped generation schedule" },
    { name: "Episode jobs", description: "Asynchronous generation jobs" },
    {
      name: "AI enrichment",
      description: "AI article enrichment queue and on-demand recompute",
    },
    { name: "Agent runtime", description: "Agent runs and safe timeline" },
    { name: "Agent memory", description: "Owner-scoped durable Agent memory" },
    { name: "Episodes", description: "Completed episodes and audio access" },
    {
      name: "Reading Dictionary",
      description: "Owner-scoped word-reading dictionary for TTS quality",
    },
  ],
  servers: [{ url: "http://localhost:4173", description: "Local development" }],
}
