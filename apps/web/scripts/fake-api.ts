import { randomUUID } from "node:crypto"

const sessionCookie = "news-podcast-e2e=session"
const ownerId = "00000000-0000-4000-8000-000000000100"
const feedId = "00000000-0000-4000-8000-000000000001"
const subscriptionId = "00000000-0000-4000-8000-000000000002"
const createdAt = "2026-08-10T00:00:00.000Z"
/** 視覚回帰が`?episode=`で名指しできるよう、seedの番組IDは固定する。 */
const seededEpisodeId = "00000000-0000-4000-8000-000000000030"

export const fakeApiIdentifiers = {
  sessionCookie,
  ownerId,
  feedId,
  subscriptionId,
  episodeId: seededEpisodeId,
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

type Tag = { id: string; name: string; createdAt: string }

type TagSuggestion = {
  name: string
  occurrences: number
  lastSeenAt: string
}

type ReadingDictionaryEntry = {
  id: string
  surface: string
  reading: string
  accentType: number
  source: "manual" | "ai_auto"
  episodeJobId: string | null
  createdAt: string
  updatedAt: string
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

/**
 * ライブラリは「原稿を読みながら出典を確かめる」画面なので、seedにも
 * 段落のある台本と、保存済み・未保存の両方の出典を持たせる。空に近いseedだと
 * 2ペインの幅の使い方も右レールも絵に出ない。
 */
function seedEpisodes(): Array<Record<string, unknown>> {
  return [
    {
      id: seededEpisodeId,
      title: "今日の開発ニュース: Durable ObjectsとTypeScript 6.0",
      script: [
        "こんばんは。今日の開発ニュースをお届けします。",
        "最初の話題です。Durable Objectsが東京リージョンに対応しました。国内からの往復が短くなり、状態を持つ処理を日本のユーザーの近くへ置けるようになります。",
        "次の話題です。TypeScript 6.0のリリース候補が公開されました。型推論の改善に加えて、既定値の変更がいくつか入っています。",
        "最後に、SQLiteのWALモードと本番運用の勘所を紹介します。書き込みの詰まりをどこで観測するかが要点です。",
        "本日は以上です。詳しくは出典の記事をご確認ください。",
      ].join("\n\n"),
      sources: [
        {
          articleId: "00000000-0000-4000-8000-000000000010",
          url: "https://zenn.dev/seed-1",
          title: "Durable Objectsが東京リージョンに対応",
          publishedAt: createdAt,
          snapshotId: "00000000-0000-4000-8000-000000000020",
          sourceKind: "rss",
        },
        {
          articleId: "00000000-0000-4000-8000-000000000011",
          url: "https://zenn.dev/seed-2",
          title: "TypeScript 6.0のリリース候補が公開",
          publishedAt: createdAt,
          snapshotId: "00000000-0000-4000-8000-000000000021",
          sourceKind: "rss",
        },
        {
          url: "https://example.com/sqlite-wal",
          title: "SQLiteのWALモードと本番運用の勘所",
          publishedAt: createdAt,
          sourceKind: "web",
        },
      ],
      createdAt: "2026-08-18T21:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000031",
      title: "先週の総まとめ: 型システムと配信基盤",
      script: [
        "今週の開発ニュースをまとめてお届けします。",
        "型システムの話題が続いた一週間でした。推論の改善と、既存コードへの影響を整理します。",
      ].join("\n\n"),
      sources: [
        {
          articleId: "00000000-0000-4000-8000-000000000012",
          url: "https://zenn.dev/seed-3",
          title: "SQLiteのWALモードと本番運用の勘所",
          publishedAt: createdAt,
          snapshotId: "00000000-0000-4000-8000-000000000022",
          sourceKind: "rss",
        },
      ],
      createdAt: "2026-08-11T21:00:00.000Z",
    },
  ]
}

/**
 * 設定画面は「登録済みが何十件も並んだ状態」でこそ一覧性が問われる。
 * 空に近いseedだと、幅の使い方も折り返しも絵に出ない。
 */
function seedTags(): Tag[] {
  return [
    "生成AI",
    "フロントエンド",
    "TypeScript",
    "データベース",
    "セキュリティ",
    "インフラ",
    "設計",
    "パフォーマンス",
    "アクセシビリティ",
    "モバイル",
    "オープンソース",
    "開発者体験",
  ].map((name, index) => ({
    id: `00000000-0000-4000-8000-00000000003${index.toString(16)}`,
    name,
    createdAt,
  }))
}

function seedTagSuggestions(): TagSuggestion[] {
  return [
    ["エッジコンピューティング", 12],
    ["WebAssembly", 9],
    ["観測可能性", 7],
    ["Rust", 6],
    ["分散システム", 5],
    ["型システム", 4],
    ["CI/CD", 3],
    ["ビルドツール", 3],
    ["状態管理", 2],
    ["テスト戦略", 2],
  ].map(([name, occurrences]) => ({
    name: name as string,
    occurrences: occurrences as number,
    lastSeenAt: createdAt,
  }))
}

function seedReadingDictionary(): ReadingDictionaryEntry[] {
  return [
    ["GPT-5", "ジーピーティーファイブ", "manual"],
    ["Durable Objects", "デュラブルオブジェクツ", "ai_auto"],
    ["SQLite", "エスキューライト", "manual"],
    ["WAL", "ダブリューエーエル", "ai_auto"],
    ["TypeScript", "タイプスクリプト", "manual"],
    ["Kubernetes", "クーベルネティス", "ai_auto"],
    ["OAuth", "オーオース", "manual"],
    ["nginx", "エンジンエックス", "ai_auto"],
  ].map(([surface, reading, source], index) => ({
    id: `00000000-0000-4000-8000-00000000004${index.toString(16)}`,
    surface: surface as string,
    reading: reading as string,
    accentType: 0,
    source: source as "manual" | "ai_auto",
    episodeJobId: null,
    createdAt,
    updatedAt: createdAt,
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
      interestProfile: {
        include: "生成AIの基盤モデル、フロントエンドの新技術、型システム",
        exclude: "芸能ゴシップ、スポーツの試合速報",
      },
    },
    jobs: [] as Job[],
    syncJob: undefined as FeedSyncJob | undefined,
    episodes: seedEpisodes(),
    tags: seedTags(),
    suggestions: seedTagSuggestions(),
    dictionary: seedReadingDictionary(),
    dailyUsed: 34,
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
    if (path === "/v1/me/tags") {
      if (request.method === "POST") {
        const body = (await request.json()) as { name: string }
        const tag: Tag = {
          id: randomUUID(),
          name: body.name,
          createdAt: new Date().toISOString(),
        }
        state.tags = [...state.tags, tag]
        return json(tag, 201)
      }
      return json({ items: state.tags, page: { hasMore: false } })
    }
    const tagMatch = /^\/v1\/me\/tags\/([^/]+)$/.exec(path)
    if (tagMatch && request.method === "DELETE") {
      state.tags = state.tags.filter((tag) => tag.id !== tagMatch[1])
      return new Response(null, { status: 204 })
    }
    if (path === "/v1/me/tag-suggestions" && request.method === "GET") {
      return json({ items: state.suggestions, page: { hasMore: false } })
    }
    if (
      path === "/v1/me/tag-suggestions/promote" &&
      request.method === "POST"
    ) {
      const body = (await request.json()) as { name: string }
      const suggestion = state.suggestions.find(
        (item) => item.name === body.name
      )
      if (suggestion === undefined) return json({ error: "not found" }, 404)
      const tag: Tag = {
        id: randomUUID(),
        name: suggestion.name,
        createdAt: new Date().toISOString(),
      }
      state.tags = [...state.tags, tag]
      state.suggestions = state.suggestions.filter(
        (item) => item.name !== body.name
      )
      return json(tag, 201)
    }
    if (path === "/v1/me/reading-dictionary") {
      if (request.method === "POST") {
        const body = (await request.json()) as {
          surface: string
          reading: string
          accentType?: number
        }
        const now = new Date().toISOString()
        const entry: ReadingDictionaryEntry = {
          id: randomUUID(),
          surface: body.surface,
          reading: body.reading,
          accentType: body.accentType ?? 0,
          source: "manual",
          episodeJobId: null,
          createdAt: now,
          updatedAt: now,
        }
        state.dictionary = [entry, ...state.dictionary]
        return json(entry, 201)
      }
      return json({ items: state.dictionary, page: { hasMore: false } })
    }
    const dictionaryMatch = /^\/v1\/me\/reading-dictionary\/([^/]+)$/.exec(path)
    if (dictionaryMatch) {
      const entry = state.dictionary.find(
        (item) => item.id === dictionaryMatch[1]
      )
      if (entry === undefined) return json({ error: "not found" }, 404)
      if (request.method === "DELETE") {
        state.dictionary = state.dictionary.filter(
          (item) => item.id !== entry.id
        )
        return new Response(null, { status: 204 })
      }
      if (request.method === "PUT") {
        const patch = (await request.json()) as Partial<ReadingDictionaryEntry>
        Object.assign(entry, patch, { updatedAt: new Date().toISOString() })
        return json(entry)
      }
    }
    if (path === "/v1/me/enrich/queue" && request.method === "GET") {
      return json({
        processing: [],
        pending: { count: 0, items: [] },
        failed: { count: 0, items: [] },
        recent: [],
        daily: { used: state.dailyUsed, limit: 200 },
        reprocessable: { count: articles.length },
      })
    }
    if (path === "/v1/me/enrich/reprocess" && request.method === "POST") {
      return json({ enqueued: articles.length })
    }
    if (path === "/v1/me/enrich/reset-daily" && request.method === "POST") {
      state.dailyUsed = 0
      return json({ message: "Daily enrichment usage reset" })
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
    const episodeMatch = /^\/v1\/episodes\/([^/]+)$/.exec(path)
    if (episodeMatch && request.method === "GET") {
      const episode = state.episodes.find((item) => item.id === episodeMatch[1])
      return episode ? json(episode) : json({ error: "not found" }, 404)
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
/**
 * 無音のWAV。
 *
 * 一瞬で鳴り終わる長さにすると、「ページを移っても再生が続く」ことを
 * e2eで確かめられない (遷移する前に`ended`が来る)。実際の番組と同じように、
 * 数十秒は鳴り続ける長さを持たせる。
 */
function silentWave(seconds = 30): Uint8Array<ArrayBuffer> {
  const sampleRate = 8_000
  const bytesPerSample = 2
  const dataBytes = sampleRate * bytesPerSample * seconds
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (const [index, character] of Array.from(text).entries()) {
      view.setUint8(offset + index, character.charCodeAt(0))
    }
  }

  ascii(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  ascii(36, "data")
  view.setUint32(40, dataBytes, true)
  // 本体は無音なので0のまま。
  return new Uint8Array(buffer)
}
