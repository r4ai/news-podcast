import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { LocalStore } from "@news-podcast/adapters/db/local"
import { CreateEpisodeJob } from "@news-podcast/application"
import { createServer } from "vite"

import { createApp } from "../../api/src/app.js"
import {
  createAudioAccess,
  createDevAuth,
} from "../../api/src/local-services.js"
import { createFakeProcessor } from "../../worker/src/process-episode-job.js"
import { LocalScheduler } from "../../worker/src/scheduler.js"

const directory = mkdtempSync(join(tmpdir(), "news-podcast-e2e-"))
const apiPort = Number(process.env.E2E_API_PORT ?? 4000)
const webPort = Number(process.env.E2E_WEB_PORT ?? 4173)
const ownerId = "00000000-0000-4000-8000-000000000100"
const store = new LocalStore(join(directory, "app.sqlite"))
const devAuth = createDevAuth({
  enabled: true,
  secret: "e2e-better-auth-secret-at-least-32-characters",
  password: "e2e-password",
  ownerId,
  store,
})
const audio = createAudioAccess({
  secret: "e2e-audio-access-secret-at-least-32-characters",
  baseUrl: `http://127.0.0.1:${webPort}`,
  store,
  directory: join(directory, "audio"),
})
const processor = createFakeProcessor(store, join(directory, "audio"))
const scheduler = new LocalScheduler(store)

await seedArchivedArticles()

/**
 * 生成前の記事選択ダイアログは「アーカイブ済み」記事しか候補にしないので、
 * fakeモードでも実際に選べる記事を用意しておく。これが無いとダイアログは
 * 常に空状態になり、選択フローをe2eでもローカルでも確認できない。
 */
async function seedArchivedArticles() {
  store.ensureDefaultSubscriptions(ownerId)
  const feedId = (await store.listEnabledFeedIds(ownerId))[0]
  if (!feedId) return
  const seeds = [
    { externalId: "seed-1", title: "Durable Objectsが東京リージョンに対応" },
    { externalId: "seed-2", title: "TypeScript 6.0のリリース候補が公開" },
    { externalId: "seed-3", title: "SQLiteのWALモードと本番運用の勘所" },
  ]
  store.upsertFeedItems(
    feedId,
    seeds.map((seed) => ({
      externalId: seed.externalId,
      title: seed.title,
      url: `https://zenn.dev/${seed.externalId}`,
      publishedAt: new Date().toISOString(),
      summary: `${seed.title}の要約です。`,
    }))
  )
  for (const article of store.listArticles(ownerId, { limit: 50 }).items) {
    if (!article.url.startsWith("https://zenn.dev/seed-")) continue
    store.completeArchive({
      articleId: article.id,
      snapshotId: randomUUID(),
      sourceUrl: article.url,
      title: article.title,
      contentHash: `hash-${article.id}`,
      rawKey: `articles/${article.id}/raw.html`,
      replayKey: `articles/${article.id}/replay.html`,
      markdownKey: `articles/${article.id}/body.md`,
      byteLength: 1024,
      assets: [],
    })
  }
}

const app = createApp({
  store,
  resolveOwner: async (request) => devAuth.owner(request),
  devLoginHandler: (request) => devAuth.login(request),
  devLogoutHandler: () => devAuth.logout(),
  loginMethods: { development: true, google: false },
  createEpisodeJob: async ({
    ownerId: requestedOwner,
    idempotencyKey,
    articleIds,
  }) => {
    const useCase = new CreateEpisodeJob(store, store, {
      dispatch: () => Promise.resolve(),
    })
    const record = await useCase.execute({
      ownerId: requestedOwner,
      idempotencyKey,
      trigger: "manual",
      ...(articleIds ? { articleIds } : {}),
    })
    return store.getJob(requestedOwner, record.jobId)!
  },
  issueAudioAccess: (requestedOwner, episodeId) =>
    audio.issue(requestedOwner, episodeId),
  serveAudio: (token, range) => audio.serve(token, range),
})

const apiServer = serve({ fetch: app.fetch, port: apiPort })
process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`
const vite = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: webPort },
})
await vite.listen()

let ticking = false
const timer = setInterval(async () => {
  if (ticking) return
  ticking = true
  try {
    await scheduler.run()
    const job = store.leaseNext()
    if (job) await processor.process(job)
  } finally {
    ticking = false
  }
}, 250)

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  clearInterval(timer)
  await vite.close()
  await new Promise<void>((resolve) => apiServer.close(() => resolve()))
  store.close()
  rmSync(directory, { recursive: true, force: true })
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(0)))
}
await new Promise(() => {})
