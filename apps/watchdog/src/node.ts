import { createServer } from "node:http"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { watchdogTargets } from "./config.js"
import { watchdogMetrics } from "./metrics.js"
import { createWatchdogNotifier } from "./notifier.js"
import { checkWatchdog, type WatchdogState } from "./watchdog.js"

const statePath =
  process.env.WATCHDOG_STATE_PATH ?? "/var/lib/news-podcast-watchdog/state.json"
const intervalMs = readPositiveNumber("WATCHDOG_INTERVAL_MS", 60_000)
const port = readPositiveNumber("WATCHDOG_PORT", 4_199)
const targets = watchdogTargets()
const collectorMetricsUrl =
  process.env.WATCHDOG_COLLECTOR_METRICS_URL?.trim() || undefined
const notifier = createWatchdogNotifier(process.env)

let state = await loadState()
let stopping = false
let timer: NodeJS.Timeout | undefined
let active: Promise<void> = Promise.resolve()
let lastCheckSucceeded = false
let lastCheckAt: string | undefined

const server = createServer((request, response) => {
  response.setHeader("cache-control", "no-store")
  if (request.url === "/health/live") {
    response.setHeader("content-type", "application/json")
    response.statusCode = 200
    response.end('{"status":"live"}')
    return
  }
  if (request.url === "/metrics") {
    response.setHeader("content-type", "text/plain; version=0.0.4")
    response.statusCode = 200
    response.end(watchdogMetrics(state, lastCheckSucceeded, lastCheckAt))
    return
  }
  response.statusCode = 404
  response.end("not found")
})
await new Promise<void>((resolve, reject) => {
  server.once("error", reject)
  server.listen(port, "0.0.0.0", resolve)
})

function schedule(delay = 0): void {
  timer = setTimeout(() => {
    active = run()
      .catch((error) => {
        lastCheckSucceeded = false
        lastCheckAt = new Date().toISOString()
        process.stderr.write(
          `${JSON.stringify({ event: "watchdog.check_failed", error: safeError(error) })}\n`
        )
      })
      .finally(() => {
        if (!stopping) schedule(intervalMs)
      })
  }, delay)
}

async function run(): Promise<void> {
  const now = new Date()
  const result = await checkWatchdog({
    state,
    targets,
    ...(collectorMetricsUrl === undefined ? {} : { collectorMetricsUrl }),
    now,
  })
  if (result.notification) await notifier.send(result.notification)
  state = result.state
  await saveState(state)
  lastCheckSucceeded = true
  lastCheckAt = now.toISOString()
}

schedule()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (stopping) return
    stopping = true
    if (timer) clearTimeout(timer)
    void Promise.all([
      active,
      new Promise<void>((resolve) => server.close(() => resolve())),
    ]).finally(() => {
      notifier.close()
      process.exit(0)
    })
  })
}

async function loadState(): Promise<WatchdogState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as WatchdogState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { failures: {} }
    throw error
  }
}

async function saveState(next: WatchdogState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  const temporary = `${statePath}.tmp`
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
  await rename(temporary, statePath)
}

function readPositiveNumber(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${key} must be positive`)
  return value
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 200)
    : "unknown failure"
}
