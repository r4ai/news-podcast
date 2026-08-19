import { createServer } from "node:http"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

const initialState = () => ({
  schemaVersion: 1,
  lastBackupSuccessAt: null,
  lastBackupGeneration: null,
  lastDrillSuccessAt: null,
  lastDrillGeneration: null,
  backupFailuresTotal: 0,
  drillFailuresTotal: 0,
})

const loadState = async (path) => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    return { ...initialState(), ...parsed }
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
    try {
      const result = await operation()
      const completedAt = (
        this.options.now ?? (() => new Date())
      )().toISOString()
      if (kind === "backup") {
        this.state.lastBackupSuccessAt = completedAt
        this.state.lastBackupGeneration = result.commit.generationId
      } else {
        this.state.lastDrillSuccessAt = completedAt
        this.state.lastDrillGeneration = result.generationId
      }
      await saveState(this.options.statePath, this.state)
      return true
    } catch (error) {
      if (kind === "backup") this.state.backupFailuresTotal += 1
      else this.state.drillFailuresTotal += 1
      await saveState(this.options.statePath, this.state)
      ;(this.options.logger ?? console).error(
        JSON.stringify({
          event: `${kind}.failed`,
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
  return `# HELP news_podcast_backup_last_success_timestamp_seconds Unix time of the last committed coordinated backup.
# TYPE news_podcast_backup_last_success_timestamp_seconds gauge
news_podcast_backup_last_success_timestamp_seconds ${lastBackup}
# HELP news_podcast_backup_generation_age_seconds Age of the latest committed generation, or -1 before first success.
# TYPE news_podcast_backup_generation_age_seconds gauge
news_podcast_backup_generation_age_seconds ${age}
# HELP news_podcast_backup_failures_total Coordinated backup failures.
# TYPE news_podcast_backup_failures_total counter
news_podcast_backup_failures_total ${state.backupFailuresTotal}
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
