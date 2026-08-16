import { randomUUID } from "node:crypto"

const sessionCookie = "news-podcast-e2e=session"
const ownerId = "00000000-0000-4000-8000-000000000100"
const feedId = "00000000-0000-4000-8000-000000000001"
const subscriptionId = "00000000-0000-4000-8000-000000000002"
const createdAt = "2026-08-10T00:00:00.000Z"

export const fakeApiIdentifiers = {
  sessionCookie,
  ownerId,
  feedId,
  subscriptionId,
} as const

type Job = {
  id: string
  status: "succeeded"
  createdAt: string
  articleIds: string[]
  attempt: number
  maxAttempts: 4
  episodeId: string
}

type FeedSyncJob = {
  jobId: string
  feedId: string
  feedUrl: string
  status: "queued"
  attempt: number
  maxAttempts: 4
  discovered: number
  archived: number
  failed: number
  createdAt: string
}

/**
 * リーダーの見た目を固定するための本文。
 * 保存側の正規化どおり、最も浅い見出しをlevel 1として作る。先頭の題名再掲は
 * 表示側が落とし、残りの見出しは押し下げられる — その両方を絵で確認する。
 *
 * 保存Markdownの方言(callout、meta付きコードフェンス、表、脚注、強調、区切り)
 * を一通り含める。段落と箇条書きだけだと、Markdownコンポーネントを変えても
 * スナップショットに差が出ず、視覚回帰がゲートとして働かない。
 */
export const articleBody = (title: string) =>
  [
    `# ${title}`,
    "",
    "この記事は視覚回帰テスト用の固定本文です。**強調**と`inline code`、",
    "[リンク](https://example.com/ref)を含みます。",
    "",
    "## 確認したいこと",
    "",
    "- 一覧と本文は独立したスクロール領域になる",
    "- 既読は記事を離れた時点で反映される",
    "",
    "> [!note]",
    "> callout はアイコンと配色を持つ。",
    "",
    '```ts title="src/reader.ts" showLineNumbers=true',
    "export const readerBaseHeadingLevel = 3",
    "export const tocMaximumDepth = 2",
    "```",
    "",
    "### 対応状況",
    "",
    "| 記法 | 対応 |",
    "| --- | --- |",
    "| callout | 済 |",
    "| 脚注 | 済[^1] |",
    "",
    "---",
    "",
    "[^1]: 脚注は本文の末尾へ集まる。",
    "",
  ].join("\n")

function seedArticles() {
  return [
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
}

export type FakeApi = {
  readonly fetch: (request: Request) => Promise<Response>
  readonly articles: ReturnType<typeof seedArticles>
}

/**
 * e2e/視覚回帰で使う偽Gateway。
 *
 * 応答の形は必ず`packages/contracts/openapi/openapi.json`に従う。ここが実契約
 * から外れると、Web側のバグに偽物が「合わせて」しまい、どのテスト層でも
 * 検知できなくなる(実際に本文Markdownで起きた)。`fake-api.contract.test.ts`
 * がOpenAPIとの一致を検査するので、応答を変える時はそちらも通すこと。
 */
export function createFakeApi(): FakeApi {
  const articles = seedArticles()
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
    syncJob: undefined as FeedSyncJob | undefined,
    episodes: [] as Array<Record<string, unknown>>,
  }

  async function fetch(request: Request): Promise<Response> {
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
      return json({
        items: state.syncJob === undefined ? [] : [state.syncJob],
        page: { hasMore: false },
      })
    }
    if (
      path === `/v1/me/feed-subscriptions/${subscriptionId}/sync` &&
      request.method === "POST"
    ) {
      state.syncJob = {
        jobId: randomUUID(),
        feedId,
        feedUrl: "https://zenn.dev/feed",
        status: "queued",
        attempt: 0,
        maxAttempts: 4,
        discovered: 0,
        archived: 0,
        failed: 0,
        createdAt: new Date().toISOString(),
      }
      return json(state.syncJob, 202)
    }
    if (path === `/v1/me/feed-subscriptions/${subscriptionId}`) {
      if (request.method === "PATCH") {
        const patch = (await request.json()) as { enabled: boolean }
        state.subscription.enabled = patch.enabled
        return json(state.subscription)
      }
      if (request.method === "DELETE")
        return new Response(null, { status: 204 })
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
    const articleMatch = /^\/v1\/me\/articles\/([^/]+)(\/markdown)?$/.exec(path)
    if (articleMatch) {
      const article = articles.find((item) => item.id === articleMatch[1])
      if (!article) return json({ error: "not found" }, 404)
      // 本文はOpenAPI通り`application/json`の`{ markdown }`で返す。
      // text/markdownで生本文を返すとWeb側の`parseAs: "text"`バグと
      // 辻褄が合ってしまい、壊れていることを誰も検知できない。
      if (articleMatch[2] === "/markdown") {
        return json({ markdown: articleBody(article.title) })
      }
      if (request.method === "PATCH") {
        const patch = (await request.json()) as Record<string, boolean>
        Object.assign(article, patch)
      }
      return json(article)
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
      return job
        ? eventStream(job, articles)
        : json({ error: "not found" }, 404)
    }
    if (path === "/v1/episodes") {
      return json({ items: state.episodes, page: { hasMore: false } })
    }
    const audioMatch = path.match(/^\/v1\/episodes\/([^/]+)\/audio$/)
    if (audioMatch && request.method === "GET") {
      return new Response(silentWave(), {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Type": "audio/wav",
        },
      })
    }

    return json({ error: "not found" }, 404)
  }

  return { fetch, articles }
}

function eventStream(job: Job, articles: FakeApi["articles"]): Response {
  const adopted = {
    articleId: job.articleIds[0] ?? articles[0]!.id,
    title: "ローカルE2Eニュース",
    sourceName: "開発ニュース",
  }
  const now = Date.now()
  const runId = `${job.id}:attempt:1`
  const events = [
    {
      type: "STATE_SNAPSHOT",
      timestamp: now,
      snapshot: {
        jobId: job.id,
        status: "running",
        attempt: 1,
        maxAttempts: 4,
        selectionMode: "manual",
        selectedArticles: [adopted],
        currentStage: "selecting_articles",
      },
    },
    {
      type: "RUN_STARTED",
      timestamp: now,
      threadId: job.id,
      runId,
    },
    {
      type: "STEP_STARTED",
      timestamp: now,
      stepName: "selecting_articles",
    },
    {
      type: "STEP_FINISHED",
      timestamp: now,
      stepName: "selecting_articles",
    },
    {
      type: "STEP_STARTED",
      timestamp: now,
      stepName: "materializing_articles",
    },
    {
      type: "STEP_FINISHED",
      timestamp: now,
      stepName: "materializing_articles",
    },
    {
      type: "STATE_SNAPSHOT",
      timestamp: now,
      snapshot: {
        jobId: job.id,
        status: "succeeded",
        attempt: 1,
        maxAttempts: 4,
        selectionMode: "manual",
        selectedArticles: [adopted],
        episodeId: job.episodeId,
      },
    },
    {
      type: "RUN_FINISHED",
      timestamp: now,
      threadId: job.id,
      runId,
      outcome: { type: "success" },
    },
  ]
  const body = events
    .map(
      (event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`
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

// `Uint8Array.from`は`ArrayBufferLike`を返し`BodyInit`に代入できないので、
// バッファ型が確定する`new Uint8Array`で作る。
function silentWave(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    82, 73, 70, 70, 38, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0,
    1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0,
    2, 0, 0, 0, 0, 0,
  ])
}
