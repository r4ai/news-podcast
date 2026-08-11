import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import nodemailer from "nodemailer"

import { checkWatchdog, type WatchdogState } from "./watchdog.js"

const statePath =
  process.env.WATCHDOG_STATE_PATH ?? "/var/lib/news-podcast-watchdog/state.json"
const intervalMs = readPositiveNumber("WATCHDOG_INTERVAL_MS", 60_000)
const targets = [
  {
    name: "api",
    url: process.env.WATCHDOG_API_URL ?? "http://127.0.0.1:4000/health",
  },
  {
    name: "worker",
    url: process.env.WATCHDOG_WORKER_URL ?? "http://127.0.0.1:3001/health",
  },
  {
    name: "voicevox",
    url: process.env.WATCHDOG_VOICEVOX_URL ?? "http://127.0.0.1:50021/version",
  },
  {
    name: "signoz",
    url:
      process.env.WATCHDOG_SIGNOZ_URL ?? "http://127.0.0.1:8100/api/v1/health",
  },
]
const collectorMetricsUrl =
  process.env.WATCHDOG_COLLECTOR_METRICS_URL ?? "http://127.0.0.1:8888/metrics"
const transport = nodemailer.createTransport({
  host: required("WATCHDOG_SMTP_HOST"),
  port: readPositiveNumber("WATCHDOG_SMTP_PORT", 587),
  secure: process.env.WATCHDOG_SMTP_SECURE === "true",
  requireTLS: process.env.WATCHDOG_SMTP_SECURE !== "true",
  auth: {
    user: required("WATCHDOG_SMTP_USERNAME"),
    pass: required("WATCHDOG_SMTP_PASSWORD"),
  },
})
const from = required("WATCHDOG_SMTP_FROM")
const to = required("WATCHDOG_SMTP_TO")

let stopping = false
let timer: NodeJS.Timeout | undefined
let active: Promise<void> = Promise.resolve()

function schedule(delay = 0): void {
  timer = setTimeout(() => {
    active = run()
      .catch((error) => {
        process.stderr.write(`Watchdog check failed: ${safeError(error)}\n`)
      })
      .finally(() => {
        if (!stopping) schedule(intervalMs)
      })
  }, delay)
}

async function run(): Promise<void> {
  const state = await loadState()
  const result = await checkWatchdog({
    state,
    targets,
    collectorMetricsUrl,
    now: new Date(),
  })
  if (result.notification) {
    await transport.sendMail({
      from,
      to,
      subject: result.notification.subject,
      text: result.notification.text,
    })
  }
  await saveState(result.state)
}

schedule()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    if (timer) clearTimeout(timer)
    void active.finally(() => transport.close())
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

async function saveState(state: WatchdogState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  const temporary = `${statePath}.tmp`
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
  await rename(temporary, statePath)
}

function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required configuration: ${key}`)
  return value
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
