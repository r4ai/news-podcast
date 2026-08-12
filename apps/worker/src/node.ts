import {
  createPropagationHook,
  getNodeObservability,
} from "@news-podcast/observability/node/register"
import { LocalStore } from "@news-podcast/adapters/db/local"
import {
  readArchiveLimits,
  readOpenAiConfig,
  readS3Config,
  readVoicevoxConfig,
} from "@news-podcast/adapters/config"
import { S3ObjectStore } from "@news-podcast/adapters/object-store/s3"
import { DEFAULT_AI_ENRICH_DAILY_LIMIT } from "@news-podcast/adapters/ai-enrich/shared"
import { OpenAiArticleSummarizer } from "@news-podcast/adapters/ai-enrich/summarizer"
import { OpenAiRelevanceScorer } from "@news-podcast/adapters/ai-enrich/scorer"
import { AiEnrichWorker } from "@news-podcast/adapters/ai-enrich/worker"
import { createNodeSafeFetcher } from "@news-podcast/adapters/http/safe"

import {
  createFakeProcessor,
  createLiveProcessor,
} from "./process-episode-job.js"
import { LocalScheduler } from "./scheduler.js"
import { RssArchiveWorker } from "./process-rss-archive.js"
import { createObservedObjectStore } from "./observed-object-store.js"

const databasePath = required("DATABASE_PATH")
const mode = process.env.PROVIDER_MODE ?? "live"
const observability = getNodeObservability({
  serviceName: "news-podcast-worker",
  traceSampleRate: 1,
})
if (mode === "fake" && process.env.APP_ENV === "production") {
  throw new Error("Fake providers are forbidden in production")
}

const store = new LocalStore(databasePath)
const objects = new S3ObjectStore(readS3Config(process.env))
const observedObjects = createObservedObjectStore(objects, observability)
const processor =
  mode === "fake"
    ? createFakeProcessor(store, required("AUDIO_DIRECTORY"), observability)
    : createLiveProcessor({
        store,
        objects: observedObjects,
        openAi: readOpenAiConfig(process.env),
        voicevox: readVoicevoxConfig(process.env),
        observability,
      })
const scheduler = new LocalScheduler(store)
const safeHttp = createNodeSafeFetcher({ propagate: createPropagationHook() })
const rssArchive = new RssArchiveWorker(
  store,
  objects,
  observability,
  readArchiveLimits(process.env),
  safeHttp.fetch
)
const openAiConfig = mode === "fake" ? undefined : readOpenAiConfig(process.env)
const aiEnrich = openAiConfig
  ? new AiEnrichWorker(
      store,
      objects,
      new OpenAiArticleSummarizer(openAiConfig),
      new OpenAiRelevanceScorer(openAiConfig),
      openAiConfig.model,
      readAiEnrichDailyLimit(process.env),
      (event) => {
        if (event.type === "summary_succeeded") {
          recordEnrichTokens("summary", event.tokensIn, event.tokensOut)
          observability.log({ name: "article.enrich.summary.succeeded" })
          if (event.warnings.includes("invalid-mermaid-removed")) {
            observability.log({
              name: "article.enrich.summary.degraded",
              level: "warn",
              attributes: { "degradation.reason": "invalid-mermaid-removed" },
            })
          }
        } else if (event.type === "summary_failed") {
          observability.log({
            name: "article.enrich.summary.failed",
            level: "warn",
            error: event.error,
          })
          if (event.rateLimited) {
            observability.log({
              name: "article.enrich.rate_limited",
              level: "warn",
            })
          }
        } else if (event.type === "relevance_succeeded") {
          recordEnrichTokens("relevance", event.tokensIn, event.tokensOut)
          observability.count("article.enrich.processed", event.count)
          observability.log({ name: "article.enrich.relevance.succeeded" })
        } else {
          observability.log({
            name: "article.enrich.relevance.failed",
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
  : undefined

function recordEnrichTokens(
  step: "summary" | "relevance",
  tokensIn: number,
  tokensOut: number
): void {
  observability.count("article.enrich.tokens", tokensIn, {
    "enrich.step": step,
    "token.kind": "in",
  })
  observability.count("article.enrich.tokens", tokensOut, {
    "enrich.step": step,
    "token.kind": "out",
  })
}

const healthPort = readPort("WORKER_HEALTH_PORT", 3001)
let livenessAt = Date.now()
const livenessTimer = setInterval(() => {
  livenessAt = Date.now()
}, 5_000)
livenessTimer.unref()
const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end()
    return
  }
  const healthy = Date.now() - livenessAt < 20_000 && !stopping
  response
    .writeHead(healthy ? 200 : 503, { "content-type": "application/json" })
    .end(JSON.stringify({ status: healthy ? "ok" : "stale" }))
})
healthServer.listen(healthPort, "0.0.0.0")

let lastTelemetryAt = 0

async function tick(): Promise<void> {
  await observability.withGuaranteedSpan("worker.tick", async () => {
    const now = new Date()
    if (now.getTime() - lastTelemetryAt >= 30_000) {
      emitHealthTelemetry(now)
      lastTelemetryAt = now.getTime()
    }
    const reconciliation = store.reconcileJobs(now)
    if (reconciliation.deadlineExceeded > 0) {
      observability.count(
        "episode.deadline.exceeded",
        reconciliation.deadlineExceeded
      )
    }
    if (reconciliation.attemptLimitExceeded > 0) {
      observability.count(
        "episode.attempt_limit.exceeded",
        reconciliation.attemptLimitExceeded
      )
    }
    await scheduler.run()
    await rssArchive.runOnce()
    if (aiEnrich) await aiEnrich.runOnce(now)
    const cleanup = store.leaseObjectCleanup()
    if (cleanup) {
      try {
        await objects.delete(cleanup.objectKey)
        store.completeObjectCleanup(cleanup.objectKey)
        observability.count("object.cleanup", 1, {
          "cleanup.result": "succeeded",
        })
        observability.log({ name: "object.cleanup.succeeded" })
      } catch (error) {
        store.failObjectCleanup(
          cleanup.objectKey,
          error instanceof Error ? error.message : "Object cleanup failed"
        )
        observability.log({
          name: "object.cleanup.failed",
          level: "error",
          error,
        })
        observability.count("object.cleanup", 1, { "cleanup.result": "failed" })
      }
    }
    const job = store.leaseNext()
    if (job) await processor.process(job)
  })
}

let stopping = false
let timer: NodeJS.Timeout | undefined
let activeTick: Promise<void> = Promise.resolve()

function scheduleTick(delay = 0): void {
  timer = setTimeout(() => {
    activeTick = tick()
      .catch((error) => {
        observability.log({
          name: "worker.tick.failed",
          level: "error",
          error,
        })
      })
      .finally(() => {
        if (!stopping) scheduleTick(1_000)
      })
  }, delay)
}

scheduleTick()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    if (timer) clearTimeout(timer)
    clearInterval(livenessTimer)
    healthServer.close()
    const grace = new Promise<void>((resolve) => setTimeout(resolve, 8_000))
    void Promise.race([activeTick, grace]).finally(() => {
      store.close()
      void Promise.all([safeHttp.close(), observability.shutdown()]).finally(
        () => process.exit(0)
      )
    })
  })
}

function emitHealthTelemetry(now: Date): void {
  const snapshot = store.getJobHealthSnapshot(now)
  for (const [status, value] of Object.entries(snapshot.jobs)) {
    observability.gauge("episode.jobs", value, { "job.status": status })
  }
  observability.gauge("episode.queue.oldest.age", snapshot.oldestQueueAgeMs)
  for (const [stage, value] of Object.entries(snapshot.oldestStageAgeMs)) {
    observability.gauge("episode.stage.oldest.age", value, {
      "operation.stage": stage,
    })
  }
  observability.gauge("episode.cleanup.backlog", snapshot.cleanupBacklog)
  observability.gauge("episode.staging.bytes", snapshot.stagingBytes)
  if (snapshot.expiredLeases > 0) {
    observability.count("episode.lease.expired", snapshot.expiredLeases)
  }
  observability.gauge("worker.heartbeat", 1)
  observability.count("otlp.canary")
  observability.log({ name: "worker.heartbeat" })
}

function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required configuration: ${key}`)
  return value
}

function readAiEnrichDailyLimit(
  env: Readonly<Record<string, string | undefined>>
): number {
  const raw = env.AI_ENRICH_DAILY_LIMIT?.trim()
  if (!raw) return DEFAULT_AI_ENRICH_DAILY_LIMIT
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("AI_ENRICH_DAILY_LIMIT must be a positive integer")
  }
  return value
}

function readPort(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${key} must be a valid TCP port`)
  }
  return value
}
import { createServer } from "node:http"
