import { LocalStore } from "@news-podcast/adapters/db/local"
import {
  readOpenAiConfig,
  readVoicevoxConfig,
} from "@news-podcast/adapters/config"

import {
  createFakeProcessor,
  createLiveProcessor,
} from "./process-episode-job.js"
import { LocalScheduler } from "./scheduler.js"
import {
  createNodeObservability,
  readNodeObservabilityConfig,
} from "@news-podcast/observability/node"

const databasePath = required("DATABASE_PATH")
const audioDirectory = required("AUDIO_DIRECTORY")
const mode = process.env.PROVIDER_MODE ?? "live"
const observability = createNodeObservability(
  readNodeObservabilityConfig(process.env, "news-podcast-worker")
)
if (mode === "fake" && process.env.APP_ENV === "production") {
  throw new Error("Fake providers are forbidden in production")
}

const store = new LocalStore(databasePath)
const processor =
  mode === "fake"
    ? createFakeProcessor(store, audioDirectory, observability)
    : createLiveProcessor({
        store,
        audioDirectory,
        openAi: readOpenAiConfig(process.env),
        voicevox: readVoicevoxConfig(process.env),
        observability,
      })
const scheduler = new LocalScheduler(store)

async function tick(): Promise<void> {
  await scheduler.run()
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
