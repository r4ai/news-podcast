import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { createServer } from "vite"

const apiPort = Number(process.env.E2E_API_PORT ?? 4000)
const webPort = Number(process.env.E2E_WEB_PORT ?? 4173)
const sessionCookie = "news-podcast-e2e=session"
const ownerId = "00000000-0000-4000-8000-000000000100"
const feedId = "00000000-0000-4000-8000-000000000001"
const subscriptionId = "00000000-0000-4000-8000-000000000002"
const createdAt = "2026-08-10T00:00:00.000Z"

type Job = {
  id: string
  status: "succeeded"
  createdAt: string
  articleIds: string[]
  attempt: number
  maxAttempts: 4
  episodeId: string
}

const articles = [
  "Durable Objectsが東京リージョンに対応",
  "TypeScript 6.0のリリース候補が公開",
  "SQLiteのWALモードと本番運用の勘所",
].map((title, index) => ({
  id: `00000000-0000-4000-8000-00000000001${index}`,
  feedId,
  sourceName: "Zenn",
  title,
  url: `https://zenn.dev/seed-${index + 1}`,
  publishedAt: createdAt,
  discoveredAt: createdAt,
  archiveStatus: "succeeded" as const,
  snapshotId: `00000000-0000-4000-8000-00000000002${index}`,
  read: false,
  saved: false,
  readLater: false,
  hidden: false,
  archiveUrl: `/v1/me/articles/00000000-0000-4000-8000-00000000001${index}/archive`,
  markdownUrl: `/v1/me/articles/00000000-0000-4000-8000-00000000001${index}/markdown`,
}))

const state = {
  subscription: { id: subscriptionId, feedId, enabled: true, createdAt },
  settings: {
    generationSchedule: {
      enabled: false,
      localTime: "07:00",
      timeZone: "Asia/Tokyo",
    },
    interestProfile: { include: "", exclude: "" },
  },
  jobs: [] as Job[],
  episodes: [] as Array<Record<string, unknown>>,
}

const apiServer = serve({ fetch: fakeApi, port: apiPort })
process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`
const vite = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: webPort },
})
await vite.listen()

async function fakeApi(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === "/health") return json({ status: "ok" })
  if (path === "/api/auth/state") {
    return json(
      authenticated(request)
        ? {
            authenticated: true,
            userId: ownerId,
            loginMethods: { development: true, google: false },
          }
        : {
            authenticated: false,
            loginMethods: { development: true, google: false },
          }
    )
  }
  if (path === "/api/dev/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}))
    if ((body as { password?: string }).password !== "e2e-password") {
      return json({ error: "invalid credentials" }, 401)
    }
    return json({ authenticated: true }, 200, {
      "Set-Cookie": `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`,
    })
  }
  if (!authenticated(request)) return json({ error: "unauthorized" }, 401)

  if (path === "/v1/feeds" && request.method === "GET") {
    return json({
      items: [
        {
          id: feedId,
          name: "Zenn",
          siteUrl: "https://zenn.dev/",
          feedUrl: "https://zenn.dev/feed",
        },
      ],
      page: { hasMore: false },
    })
  }
  if (path === "/v1/me/feed-subscriptions" && request.method === "GET") {
    return json({ items: [state.subscription], page: { hasMore: false } })
  }
  if (path === "/v1/me/feed-sync-jobs" && request.method === "GET") {
    return json({ items: [], page: { hasMore: false } })
  }
  if (path === `/v1/me/feed-subscriptions/${subscriptionId}`) {
    if (request.method === "PATCH") {
      const patch = (await request.json()) as { enabled: boolean }
      state.subscription.enabled = patch.enabled
      return json(state.subscription)
    }
    if (request.method === "DELETE") return new Response(null, { status: 204 })
  }
  if (path === "/v1/me/settings") {
    if (request.method === "PATCH") {
      const patch = (await request.json()) as Partial<typeof state.settings>
      state.settings = { ...state.settings, ...patch }
    }
    return json(state.settings)
  }
  if (path === "/v1/me/articles" && request.method === "GET") {
    return json({ items: articles, page: { hasMore: false } })
  }
  if (path === "/v1/me/articles/facets") {
    return json({
      states: { all: 3, unread: 3, saved: 0, later: 0 },
      feeds: [{ feedId, name: "Zenn", count: 3 }],
      aiPending: 0,
    })
  }
  if (path === "/v1/episode-jobs" && request.method === "GET") {
    return json({ items: state.jobs, page: { hasMore: false } })
  }
  if (path === "/v1/episode-jobs" && request.method === "POST") {
    const body = (await request.json()) as { articleIds: string[] }
    const episodeId = randomUUID()
    const job: Job = {
      id: randomUUID(),
      status: "succeeded",
      createdAt: new Date().toISOString(),
      articleIds: body.articleIds,
      attempt: 1,
      maxAttempts: 4,
      episodeId,
    }
    state.jobs.unshift(job)
    state.episodes.unshift({
      id: episodeId,
      title: "今日の開発ニュース",
      script: "ローカル環境の生成フローが正常に完了しました。",
      sources: [
        {
          url: "https://example.com/local-news",
          title: "ローカルE2Eニュース",
          publishedAt: createdAt,
          sourceKind: "rss",
        },
      ],
      createdAt: new Date().toISOString(),
    })
    return json(job, 202)
  }
  const eventMatch = path.match(/^\/v1\/episode-jobs\/([^/]+)\/events$/)
  if (eventMatch) {
    const job = state.jobs.find((item) => item.id === eventMatch[1])
    return job ? eventStream(job) : json({ error: "not found" }, 404)
  }
  if (path === "/v1/episodes") {
    return json({ items: state.episodes, page: { hasMore: false } })
  }
  const audioMatch = path.match(/^\/v1\/episodes\/([^/]+)\/audio-access$/)
  if (audioMatch && request.method === "POST") {
    return json({
      url: `http://127.0.0.1:${webPort}/v1/audio/e2e-token`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  }
  if (path === "/v1/audio/e2e-token") {
    return new Response(silentWave(), {
      headers: { "Content-Type": "audio/wav" },
    })
  }

  return json({ error: "not found" }, 404)
}

function eventStream(job: Job): Response {
  const adopted = {
    articleId: job.articleIds[0] ?? articles[0]!.id,
    title: "ローカルE2Eニュース",
    url: "https://example.com/local-news",
    sourceName: "開発ニュース",
  }
  const now = Date.now()
  const events = [
    {
      type: "STATE_SNAPSHOT",
      timestamp: now,
      snapshot: {
        jobId: job.id,
        status: "succeeded",
        attempt: 1,
        maxAttempts: 4,
        adoptedArticles: [adopted],
        episodeId: job.episodeId,
      },
    },
    {
      type: "TOOL_CALL_START",
      timestamp: now,
      toolCallId: "read-article",
      toolCallName: "read_article",
    },
    {
      type: "STATE_DELTA",
      timestamp: now,
      delta: [{ op: "add", path: "/adoptedArticles/-", value: adopted }],
    },
    {
      type: "TOOL_CALL_END",
      timestamp: now,
      toolCallId: "read-article",
    },
    { type: "RUN_FINISHED", timestamp: now, threadId: job.id, runId: job.id },
  ]
  const body = events
    .map(
      (event, index) =>
        `id: ${index + 1}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`
    )
    .join("")
  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  })
}

function authenticated(request: Request): boolean {
  return request.headers.get("cookie")?.includes(sessionCookie) ?? false
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function silentWave(): Uint8Array {
  return Uint8Array.from([
    82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0,
    1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0,
    0, 0, 0,
  ])
}

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  await vite.close()
  await new Promise<void>((resolve) => apiServer.close(() => resolve()))
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(0)))
}
await new Promise(() => {})
