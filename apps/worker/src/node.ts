import { LocalStore } from "@news-podcast/adapters/db/local"
import {
  readArchiveLimits,
  readOpenAiConfig,
  readS3Config,
  readVoicevoxConfig,
} from "@news-podcast/adapters/config"
import { S3ObjectStore } from "@news-podcast/adapters/object-store/s3"

import {
  createFakeProcessor,
  createLiveProcessor,
} from "./process-episode-job.js"
import { LocalScheduler } from "./scheduler.js"
import { RssArchiveWorker } from "./process-rss-archive.js"
import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "@news-podcast/observability/node"

const databasePath = required("DATABASE_PATH")
const mode = process.env.PROVIDER_MODE ?? "live"
const observability = createNodeObservability(
  readNodeObservabilityConfig(process.env, "news-podcast-worker")
)
if (mode === "fake" && process.env.APP_ENV === "production") {
  throw new Error("Fake providers are forbidden in production")
}

const store = new LocalStore(databasePath)
const objects = new S3ObjectStore(readS3Config(process.env))
const processor =
  mode === "fake"
    ? createFakeProcessor(store, required("AUDIO_DIRECTORY"), observability)
    : createLiveProcessor({
        store,
        objects,
        openAi: readOpenAiConfig(process.env),
        voicevox: readVoicevoxConfig(process.env),
        observability,
      })
const scheduler = new LocalScheduler(store)
const rssArchive = new RssArchiveWorker(
  store,
  objects,
  observability,
  readArchiveLimits(process.env)
)

async function tick(): Promise<void> {
  await scheduler.run()
  await rssArchive.runOnce()
  const job = store.leaseNext()
  if (job) await processor.process(job)
}

const timer = setInterval(() => void tick(), 1_000)
void tick()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer)
    store.close()
    void observability.shutdown().finally(() => process.exit(0))
  })
}

function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required configuration: ${key}`)
  return value
}
