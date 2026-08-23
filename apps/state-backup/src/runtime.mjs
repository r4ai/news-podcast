import { createServer } from "node:http"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { performance } from "node:perf_hooks"

const backupRejectionReasons = Object.freeze([
  "barrier_timeout",
  "barrier_acquisition",
  "barrier_duration_exceeded",
  "object_inventory_invalid",
  "object_inventory_changed",
  "object_changed_after_barrier",
  "cross_service_invariant",
])

const emptyBackupRejections = () =>
  Object.fromEntries(backupRejectionReasons.map((reason) => [reason, 0]))

const initialState = () => ({
  schemaVersion: 2,
  lastBackupSuccessAt: null,
  lastBackupGeneration: null,
  lastDrillSuccessAt: null,
  lastDrillGeneration: null,
  backupFailuresTotal: 0,
  drillFailuresTotal: 0,
  lastBackupDurationSeconds: 0,
  lastBackupBarrierDurationSeconds: 0,
  backupRejectionsTotal: emptyBackupRejections(),
})

const loadState = async (path) => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    const initial = initialState()
    return {
      ...initial,
      ...parsed,
      backupRejectionsTotal: {
        ...initial.backupRejectionsTotal,
        ...parsed.backupRejectionsTotal,
      },
    }
  } catch (error) {
    if (error?.code === "ENOENT") return initialState()
    throw error
  }
}

const saveState = async (path, state) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.writing`
  await rm(temporary, { force: true })
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export class BackupRuntime {
  static async open(options) {
    return new BackupRuntime(options, await loadState(options.statePath))
  }

  constructor(options, state) {
    this.options = options
    this.state = state
    this.running = false
  }

  snapshot() {
    return { ...this.state, inProgress: this.running }
  }

  async #run(kind, operation) {
    if (this.running) return false
    this.running = true
    const monotonicNow = this.options.monotonicNow ?? (() => performance.now())
    const startedAt = monotonicNow()
    try {
      const result = await operation()
      const completedAt = (
        this.options.now ?? (() => new Date())
      )().toISOString()
      if (kind === "backup") {
        this.state.lastBackupSuccessAt = completedAt
        this.state.lastBackupGeneration = result.commit.generationId
        this.state.lastBackupDurationSeconds = Math.max(
          0,
          (monotonicNow() - startedAt) / 1_000
        )
        this.state.lastBackupBarrierDurationSeconds = Math.max(
          0,
          (result.manifest?.consistency?.barrierDurationMillis ?? 0) / 1_000
        )
      } else {
        this.state.lastDrillSuccessAt = completedAt
        this.state.lastDrillGeneration = result.generationId
      }
      await saveState(this.options.statePath, this.state)
      return true
    } catch (error) {
      let reason
      if (kind === "backup") {
        this.state.backupFailuresTotal += 1
        this.state.lastBackupDurationSeconds = Math.max(
          0,
          (monotonicNow() - startedAt) / 1_000
        )
        if (Number.isFinite(error?.barrierDurationMillis)) {
          this.state.lastBackupBarrierDurationSeconds = Math.max(
            0,
            error.barrierDurationMillis / 1_000
          )
        }
        reason = backupRejectionReasons.includes(error?.code)
          ? error.code
          : undefined
        if (reason !== undefined) this.state.backupRejectionsTotal[reason] += 1
      } else this.state.drillFailuresTotal += 1
      await saveState(this.options.statePath, this.state)
      ;(this.options.logger ?? console).error(
        JSON.stringify({
          event: `${kind}.failed`,
          ...(reason === undefined ? {} : { reason }),
          error: error instanceof Error ? error.message : String(error),
        })
      )
      return false
    } finally {
      this.running = false
    }
  }

  runBackup() {
    return this.#run("backup", this.options.createGeneration)
  }

  runRestoreDrill() {
    return this.#run("drill", this.options.runRestoreDrill)
  }
}

const timestampSeconds = (value) =>
  value === null ? 0 : Math.floor(new Date(value).getTime() / 1_000)

export const renderMetrics = (state, now = new Date()) => {
  const lastBackup = timestampSeconds(state.lastBackupSuccessAt)
  const age =
    lastBackup === 0
      ? -1
      : Math.max(0, Math.floor(now.getTime() / 1_000) - lastBackup)
  const rejectionMetrics = backupRejectionReasons
    .map(
      (reason) =>
        `news_podcast_backup_rejections_total{reason="${reason}"} ${state.backupRejectionsTotal?.[reason] ?? 0}`
    )
    .join("\n")
  return `# HELP news_podcast_backup_last_success_timestamp_seconds Unix time of the last committed coordinated backup.
# TYPE news_podcast_backup_last_success_timestamp_seconds gauge
news_podcast_backup_last_success_timestamp_seconds ${lastBackup}
# HELP news_podcast_backup_generation_age_seconds Age of the latest committed generation, or -1 before first success.
# TYPE news_podcast_backup_generation_age_seconds gauge
news_podcast_backup_generation_age_seconds ${age}
# HELP news_podcast_backup_failures_total Coordinated backup failures.
# TYPE news_podcast_backup_failures_total counter
news_podcast_backup_failures_total ${state.backupFailuresTotal}
# HELP news_podcast_backup_duration_seconds Duration of the latest backup attempt.
# TYPE news_podcast_backup_duration_seconds gauge
news_podcast_backup_duration_seconds ${state.lastBackupDurationSeconds ?? 0}
# HELP news_podcast_backup_barrier_duration_seconds Duration of the latest SQLite write barrier.
# TYPE news_podcast_backup_barrier_duration_seconds gauge
news_podcast_backup_barrier_duration_seconds ${state.lastBackupBarrierDurationSeconds ?? 0}
# HELP news_podcast_backup_rejections_total Backup rejections by bounded low-cardinality reason.
# TYPE news_podcast_backup_rejections_total counter
${rejectionMetrics}
# HELP news_podcast_restore_drill_last_success_timestamp_seconds Unix time of the last successful restore drill.
# TYPE news_podcast_restore_drill_last_success_timestamp_seconds gauge
news_podcast_restore_drill_last_success_timestamp_seconds ${timestampSeconds(state.lastDrillSuccessAt)}
# HELP news_podcast_restore_drill_failures_total Restore drill failures.
# TYPE news_podcast_restore_drill_failures_total counter
news_podcast_restore_drill_failures_total ${state.drillFailuresTotal}
# HELP news_podcast_backup_in_progress Whether backup or restore work is running.
# TYPE news_podcast_backup_in_progress gauge
news_podcast_backup_in_progress ${state.inProgress ? 1 : 0}
`
}

export const startStatusServer = (runtime, port) => {
  const server = createServer((request, response) => {
    if (request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" })
      response.end(renderMetrics(runtime.snapshot()))
      return
    }
    if (request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"status":"live"}\n')
      return
    }
    response.writeHead(404).end()
  })
  server.listen(port)
  return server
}

const due = (lastSuccessAt, intervalMs, now) =>
  lastSuccessAt === null ||
  now.getTime() - Date.parse(lastSuccessAt) >= intervalMs

export const startScheduler = ({
  runtime,
  backupIntervalMs,
  drillIntervalMs,
  signal,
  tickIntervalMs = 60_000,
  now = () => new Date(),
}) => {
  let timer
  const tick = async () => {
    const state = runtime.snapshot()
    if (due(state.lastBackupSuccessAt, backupIntervalMs, now())) {
      await runtime.runBackup()
    }
    const afterBackup = runtime.snapshot()
    if (
      afterBackup.lastBackupSuccessAt !== null &&
      due(afterBackup.lastDrillSuccessAt, drillIntervalMs, now())
    ) {
      await runtime.runRestoreDrill()
    }
  }
  const schedule = () => {
    timer = setTimeout(async () => {
      await tick()
      if (!signal?.aborted) schedule()
    }, tickIntervalMs)
    timer.unref()
  }
  void tick().then(() => {
    if (!signal?.aborted) schedule()
  })
  signal?.addEventListener("abort", () => clearTimeout(timer), { once: true })
  return { tick, stop: () => clearTimeout(timer) }
}
