import { serve } from "@hono/node-server"
import { createLocalAuth } from "@news-podcast/adapters/auth/local"
import { readLocalAuthConfig } from "@news-podcast/adapters/config"
import { LocalStore } from "@news-podcast/adapters/db/local"
import { CreateEpisodeJob } from "@news-podcast/application"
import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "@news-podcast/observability/node"

import { createApp } from "./app.js"
import { createAudioAccess, createDevAuth } from "./local-services.js"

const config = readLocalAuthConfig(process.env)
const observability = createNodeObservability(
  readNodeObservabilityConfig(process.env, "news-podcast-api")
)
const store = new LocalStore(config.databasePath)
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
  directory: required("AUDIO_DIRECTORY"),
})

const app = createApp({
  store,
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
  createEpisodeJob: async ({ ownerId, idempotencyKey, traceContext }) => {
    const command = new CreateEpisodeJob(store, store, {
      dispatch: () => Promise.resolve(),
    })
    const record = await command.execute({
      ownerId,
      idempotencyKey,
      trigger: "manual",
      ...(traceContext ? { traceContext } : {}),
    })
    return store.getJob(ownerId, record.jobId)!
  },
  issueAudioAccess: (ownerId, episodeId) => audio.issue(ownerId, episodeId),
  serveAudio: (token, range) => audio.serve(token, range),
})

const server = serve(
  { fetch: app.fetch, port: Number(process.env.API_PORT ?? 3000) },
  ({ port }) => {
    console.log(`API listening on http://localhost:${port}`)
  }
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close()
      void observability.shutdown().finally(() => process.exit(0))
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
