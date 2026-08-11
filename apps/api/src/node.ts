import { serve } from "@hono/node-server"
import { createLocalAuth } from "@news-podcast/adapters/auth/local"
import { SqliteAgentRuntimeStore } from "@news-podcast/adapters/agent-runtime/sqlite"
import {
  readLocalAuthConfig,
  readOpenAiConfig,
  readS3Config,
} from "@news-podcast/adapters/config"
import { LocalStore } from "@news-podcast/adapters/db/local"
import { createNodeSafeFetcher } from "@news-podcast/adapters/http/safe"
import { S3ObjectStore } from "@news-podcast/adapters/object-store/s3"
import { RssFeedReader } from "@news-podcast/adapters/rss"
import { OpenAiArticleSummarizer } from "@news-podcast/adapters/ai-enrich/summarizer"
import { OpenAiRelevanceScorer } from "@news-podcast/adapters/ai-enrich/scorer"
import { AiEnrichWorker } from "@news-podcast/adapters/ai-enrich/worker"
import { CreateEpisodeJob } from "@news-podcast/application"
import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "@news-podcast/observability/node"

import { createApp } from "./app.js"
import {
  createArticleAccess,
  createAudioAccess,
  createDevAuth,
} from "./local-services.js"

const config = readLocalAuthConfig(process.env)
const observability = createNodeObservability(
  readNodeObservabilityConfig(process.env, "news-podcast-api")
)
const store = new LocalStore(config.databasePath)
const agentRuntimeStore = new SqliteAgentRuntimeStore(store.database)
const objects = new S3ObjectStore(readS3Config(process.env))
const auth = createLocalAuth(config)
const appEnvironment = process.env.APP_ENV ?? "development"
const devEnabled = process.env.DEV_AUTH_ENABLED === "true"
if (devEnabled && appEnvironment === "production") {
  throw new Error("Development authentication is forbidden in production")
}
const devAuth = createDevAuth({
  enabled: devEnabled,
  secret: config.secret,
  password: devEnabled ? required("DEV_AUTH_PASSWORD") : "disabled",
  ownerId:
    process.env.DEV_AUTH_USER_ID ?? "00000000-0000-4000-8000-000000000100",
  store,
})
const audio = createAudioAccess({
  secret: required("AUDIO_ACCESS_SECRET"),
  baseUrl: config.baseUrl,
  store,
  objects,
  directory: required("AUDIO_DIRECTORY"),
})
const articles = createArticleAccess({ store, objects })
const safeHttp = createNodeSafeFetcher()
const rss = new RssFeedReader(safeHttp.fetch)
// AI補助のオンデマンド再計算 (POST /v1/me/articles/{id}/enrich)。
// OpenAI設定が無い環境（ローカルのfakeモード等）ではエンドポイントを503にする。
const aiEnrich = ((): AiEnrichWorker | undefined => {
  try {
    const openAiConfig = readOpenAiConfig(process.env)
    return new AiEnrichWorker(
      store,
      objects,
      new OpenAiArticleSummarizer(openAiConfig),
      new OpenAiRelevanceScorer(openAiConfig),
      openAiConfig.model,
      undefined,
      (event) => {
        if (
          event.type === "summary_succeeded" ||
          event.type === "relevance_succeeded"
        ) {
          observability.count("article.enrich.tokens", event.tokensIn, {
            "enrich.step":
              event.type === "summary_succeeded" ? "summary" : "relevance",
            "token.kind": "in",
          })
          observability.count("article.enrich.tokens", event.tokensOut, {
            "enrich.step":
              event.type === "summary_succeeded" ? "summary" : "relevance",
            "token.kind": "out",
          })
        }
        if (
          event.type === "summary_failed" ||
          event.type === "relevance_failed"
        ) {
          observability.log({
            name:
              event.type === "summary_failed"
                ? "article.enrich.summary.failed"
                : "article.enrich.relevance.failed",
            level: "warn",
            error: event.error,
          })
          if (event.rateLimited) {
            observability.log({
              name: "article.enrich.rate_limited",
              level: "warn",
            })
          }
        }
      }
    )
  } catch {
    return undefined
  }
})()

const app = createApp({
  store,
  agentRuntimeStore,
  authHandler: auth.handler,
  devLoginHandler: (request) => devAuth.login(request),
  devLogoutHandler: () => devAuth.logout(),
  loginMethods: {
    development: devEnabled,
    google: Boolean(config.googleClientId && config.googleClientSecret),
  },
  observability,
  telemetryOrigin: new URL(config.baseUrl).origin,
  ...(process.env.TELEMETRY_PROXY_ORIGIN
    ? {
        forwardTelemetry: createTelemetryForwarder(
          process.env.TELEMETRY_PROXY_ORIGIN,
          required("TELEMETRY_PROXY_TOKEN")
        ),
      }
    : {}),
  resolveOwner: async (request) => {
    const localOwner = devAuth.owner(request)
    if (localOwner) return localOwner
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return null
    store.ensureDefaultSubscriptions(session.user.id)
    return session.user.id
  },
  createEpisodeJob: async ({
    ownerId,
    idempotencyKey,
    articleIds,
    traceContext,
  }) => {
    const command = new CreateEpisodeJob(store, store, {
      dispatch: () => Promise.resolve(),
    })
    const record = await command.execute({
      ownerId,
      idempotencyKey,
      trigger: "manual",
      ...(articleIds ? { articleIds } : {}),
      ...(traceContext ? { traceContext } : {}),
    })
    return store.getJob(ownerId, record.jobId)!
  },
  issueAudioAccess: (ownerId, episodeId) => audio.issue(ownerId, episodeId),
  serveAudio: (token, range) => audio.serve(token, range),
  discoverFeed: async (ownerId, feedUrl) => {
    const discovered = await rss.discover(feedUrl)
    return store.registerFeed({
      ownerId,
      name: discovered.name,
      siteUrl: discovered.siteUrl,
      feedUrl: discovered.feedUrl,
    })
  },
  serveArticleMarkdown: (ownerId, articleId) =>
    articles.markdown(ownerId, articleId),
  serveArticleArchive: (ownerId, articleId) =>
    articles.replay(ownerId, articleId),
  serveArticleAsset: (ownerId, articleId, hash) =>
    articles.asset(ownerId, articleId, hash),
  ...(aiEnrich
    ? {
        enrichArticle: (ownerId: string, articleId: string) =>
          aiEnrich.enrichOne(ownerId, articleId),
      }
    : {}),
})

const server = serve(
  { fetch: app.fetch, port: Number(process.env.API_PORT ?? 3000) },
  ({ port }) => {
    console.log(`API listening on http://localhost:${port}`)
  }
)

const canaryTimer = setInterval(() => {
  observability.gauge("api.heartbeat", 1)
  observability.count("otlp.canary")
  observability.log({ name: "api.heartbeat" })
}, 30_000)
canaryTimer.unref()
observability.gauge("api.heartbeat", 1)
observability.log({ name: "api.heartbeat" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(canaryTimer)
    server.close(() => {
      store.close()
      void Promise.all([safeHttp.close(), observability.shutdown()]).finally(
        () => process.exit(0)
      )
    })
  })
}

function createTelemetryForwarder(endpoint: string, token: string) {
  const baseUrl = endpoint.replace(/\/$/, "")
  return async (
    signal: "logs" | "metrics" | "traces",
    body: Uint8Array,
    contentType: string
  ): Promise<void> => {
    const response = await fetch(`${baseUrl}/v1/${signal}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body: Uint8Array.from(body).buffer,
    })
    if (!response.ok) throw new Error("Telemetry collector unavailable")
  }
}

function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required configuration: ${key}`)
  return value
}
