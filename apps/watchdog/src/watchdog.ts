export interface WatchdogState {
  readonly failures: Readonly<Record<string, string>>
  readonly lastNotificationAt?: string
  readonly telemetryValue?: number
  readonly telemetryChangedAt?: string
}

export interface CheckTarget {
  readonly name: string
  readonly url: string
}

export interface WatchdogResult {
  readonly state: WatchdogState
  readonly notification?: {
    readonly kind: "firing" | "resolved"
    readonly subject: string
    readonly text: string
  }
}

const RENOTIFY_MS = 30 * 60_000
const FRESHNESS_MS = 2 * 60_000

export async function checkWatchdog(input: {
  readonly state: WatchdogState
  readonly targets: readonly CheckTarget[]
  readonly collectorMetricsUrl: string
  readonly now: Date
  readonly fetcher?: typeof fetch
}): Promise<WatchdogResult> {
  const fetcher = input.fetcher ?? fetch
  const failures: Record<string, string> = {}
  await Promise.all(
    input.targets.map(async (target) => {
      try {
        const response = await fetcher(target.url, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) failures[target.name] = `HTTP ${response.status}`
      } catch (error) {
        failures[target.name] = safeError(error)
      }
    })
  )

  let telemetryValue = input.state.telemetryValue
  let telemetryChangedAt = input.state.telemetryChangedAt
  try {
    const response = await fetcher(input.collectorMetricsUrl, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const current = exportedPoints(await response.text())
    if (current === undefined) throw new Error("export counter missing")
    if (telemetryValue === undefined || current > telemetryValue) {
      telemetryValue = current
      telemetryChangedAt = input.now.toISOString()
    } else if (
      !telemetryChangedAt ||
      input.now.getTime() - Date.parse(telemetryChangedAt) >= FRESHNESS_MS
    ) {
      failures.telemetry = "OTLP export has not advanced for two minutes"
    }
  } catch (error) {
    failures.telemetry = safeError(error)
  }

  const previousFailures = input.state.failures
  const newlyFailed = Object.keys(failures).some(
    (name) => previousFailures[name] === undefined
  )
  const recovered = Object.keys(previousFailures).filter(
    (name) => failures[name] === undefined
  )
  const lastNotification = input.state.lastNotificationAt
    ? Date.parse(input.state.lastNotificationAt)
    : 0
  const shouldRenotify =
    Object.keys(failures).length > 0 &&
    input.now.getTime() - lastNotification >= RENOTIFY_MS
  const shouldNotify = newlyFailed || recovered.length > 0 || shouldRenotify
  const next: WatchdogState = {
    failures,
    ...(telemetryValue === undefined ? {} : { telemetryValue }),
    ...(telemetryChangedAt ? { telemetryChangedAt } : {}),
    ...(shouldNotify
      ? { lastNotificationAt: input.now.toISOString() }
      : input.state.lastNotificationAt
        ? { lastNotificationAt: input.state.lastNotificationAt }
        : {}),
  }
  if (!shouldNotify) return { state: next }

  if (Object.keys(failures).length > 0) {
    return {
      state: next,
      notification: {
        kind: "firing",
        subject: `[CRITICAL] News Podcast watchdog: ${Object.keys(failures).join(", ")}`,
        text: [
          `Detected at ${input.now.toISOString()}`,
          ...Object.entries(failures).map(
            ([name, reason]) => `${name}: ${reason}`
          ),
          ...(recovered.length > 0
            ? [`Recovered in the same check: ${recovered.join(", ")}`]
            : []),
        ].join("\n"),
      },
    }
  }
  return {
    state: next,
    notification: {
      kind: "resolved",
      subject: `[RESOLVED] News Podcast watchdog: ${recovered.join(", ")}`,
      text: `Recovered at ${input.now.toISOString()}\n${recovered.join("\n")}`,
    },
  }
}

export function exportedPoints(metrics: string): number | undefined {
  let total = 0
  let found = false
  for (const line of metrics.split("\n")) {
    if (!line.startsWith("otelcol_exporter_sent_")) continue
    const match = line.match(/\s([0-9]+(?:\.[0-9]+)?)$/)
    if (!match?.[1]) continue
    total += Number(match[1])
    found = true
  }
  return found ? total : undefined
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "request failed"
  return error.name === "TimeoutError"
    ? "request timed out"
    : error.message.slice(0, 200)
}
