import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(
  new URL("./validate-observability.sh", import.meta.url)
)
const script = await readFile(scriptPath, "utf8")
const episodeDashboard = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL(
        "../infra/observability/grafana/dashboards/episode-production.json",
        import.meta.url
      )
    ),
    "utf8"
  )
)

assert.doesNotMatch(
  script,
  /(^|\s)rg(?:\s|$)/m,
  "observability validation must use tools available on GitHub-hosted runners"
)
assert.match(script, /grep -Pzo/)

const episodeDashboardQueries = episodeDashboard.panels.flatMap((panel) =>
  (panel.targets ?? []).map((target) => target.expr ?? "")
)
assert.ok(
  episodeDashboardQueries.some((query) =>
    query.includes("episode_queue_wait_duration_bucket")
  ),
  "Episode Production dashboard must expose lease-time queue wait"
)
