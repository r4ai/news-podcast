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

const databasePath = required("DATABASE_PATH")
const audioDirectory = required("AUDIO_DIRECTORY")
const mode = process.env.PROVIDER_MODE ?? "live"
if (mode === "fake" && process.env.APP_ENV === "production") {
  throw new Error("Fake providers are forbidden in production")
}

const store = new LocalStore(databasePath)
const processor =
  mode === "fake"
    ? createFakeProcessor(store, audioDirectory)
    : createLiveProcessor({
        store,
        audioDirectory,
        openAi: readOpenAiConfig(process.env),
        voicevox: readVoicevoxConfig(process.env),
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
    process.exit(0)
  })
}

function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required configuration: ${key}`)
  return value
}
