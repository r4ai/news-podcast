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
  baseUrl: "http://127.0.0.1:4173",
  store,
  directory: join(directory, "audio"),
})
const processor = createFakeProcessor(store, join(directory, "audio"))
const scheduler = new LocalScheduler(store)

const app = createApp({
  store,
  resolveOwner: async (request) => devAuth.owner(request),
  devLoginHandler: (request) => devAuth.login(request),
  devLogoutHandler: () => devAuth.logout(),
  createEpisodeJob: async ({ ownerId: requestedOwner, idempotencyKey }) => {
    const useCase = new CreateEpisodeJob(store, store, {
      dispatch: () => Promise.resolve(),
    })
    const record = await useCase.execute({
      ownerId: requestedOwner,
      idempotencyKey,
      trigger: "manual",
    })
    return store.getJob(requestedOwner, record.jobId)!
  },
  issueAudioAccess: (requestedOwner, episodeId) =>
    audio.issue(requestedOwner, episodeId),
  serveAudio: (token, range) => audio.serve(token, range),
})

const apiServer = serve({ fetch: app.fetch, port: 3000 })
process.env.VITE_API_PROXY_TARGET = "http://127.0.0.1:3000"
const vite = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: 4173 },
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
