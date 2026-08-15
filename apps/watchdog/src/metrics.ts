import type { WatchdogState } from "./watchdog.js"

const escapeLabel = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")

export const watchdogMetrics = (
  state: WatchdogState,
  lastCheckSucceeded: boolean,
  lastCheckAt?: string
): string => {
  const lines = [
    "# HELP news_podcast_watchdog_target_up Whether the monitored target is available.",
    "# TYPE news_podcast_watchdog_target_up gauge",
  ]
  for (const [name, target] of Object.entries(state.targets ?? {}).sort()) {
    const label = `target="${escapeLabel(name)}"`
    lines.push(`news_podcast_watchdog_target_up{${label}} ${target.up ? 1 : 0}`)
    lines.push(
      `news_podcast_watchdog_target_consecutive_failures{${label}} ${target.consecutiveFailures}`
    )
    if (target.lastSuccessAt) {
      lines.push(
        `news_podcast_watchdog_target_last_success_timestamp_seconds{${label}} ${Date.parse(target.lastSuccessAt) / 1_000}`
      )
    }
  }
  lines.push(
    `news_podcast_watchdog_last_check_success ${lastCheckSucceeded ? 1 : 0}`,
    `news_podcast_watchdog_last_check_timestamp_seconds ${lastCheckAt ? Date.parse(lastCheckAt) / 1_000 : 0}`
  )
  return `${lines.join("\n")}\n`
}
