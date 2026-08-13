#!/usr/bin/env node

const grafana = process.env.GRAFANA_URL ?? "http://127.0.0.1:3100"
const prometheus = process.env.PROMETHEUS_URL ?? "http://127.0.0.1:9090"
const gateway = process.env.GATEWAY_URL ?? "http://127.0.0.1:4001"
const expectedDashboards = [
  "news-podcast-overview",
  "news-podcast-service-map",
  "news-podcast-service-drilldown",
  "news-podcast-logs",
  "news-podcast-episode",
  "news-podcast-web",
  "news-podcast-dependencies",
  "news-podcast-platform",
]

const auth = `Basic ${Buffer.from(
  `${process.env.GRAFANA_ADMIN_USER ?? "admin"}:${process.env.GRAFANA_ADMIN_PASSWORD ?? "local-only-change-me"}`
).toString("base64")}`

const request = async (url, init = {}) => {
  const response = await fetch(url, init)
  const body = await response.text()
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${url} -> ${response.status}: ${body.slice(0, 300)}`
    )
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

const grafanaRequest = (path, init = {}) =>
  request(`${grafana}${path}`, {
    ...init,
    headers: { authorization: auth, ...(init.headers ?? {}) },
  })

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const queryPrometheus = async (query) => {
  const result = await request(
    `${prometheus}/api/v1/query?query=${encodeURIComponent(query)}`
  )
  assert(result.status === "success", `Prometheus query failed: ${query}`)
  return result.data.result
}

const queryPrometheusExemplars = async (query, start, end) => {
  const params = new URLSearchParams({
    query,
    start: String(start),
    end: String(end),
  })
  const result = await request(
    `${prometheus}/api/v1/query_exemplars?${params.toString()}`
  )
  assert(
    result.status === "success",
    `Prometheus exemplar query failed: ${query}`
  )
  return result.data
}

const main = async () => {
  const health = await grafanaRequest("/api/health")
  assert(health.database === "ok", "Grafana database is not healthy")

  const dashboards = await grafanaRequest("/api/search?type=dash-db&limit=100")
  const registered = new Set(dashboards.map((dashboard) => dashboard.uid))
  for (const uid of expectedDashboards)
    assert(registered.has(uid), `Dashboard is not provisioned: ${uid}`)
  console.log(
    `dashboards=${dashboards.length} expected=${expectedDashboards.length}`
  )

  for (const uid of ["prometheus", "loki", "tempo"]) {
    const datasource = await grafanaRequest(
      `/api/datasources/uid/${uid}/health`
    )
    assert(datasource.status === "OK", `Datasource is not healthy: ${uid}`)
    console.log(`datasource=${uid} status=${datasource.status}`)
  }

  const acceptedSpans = await queryPrometheus(
    "sum(otelcol_receiver_accepted_spans_total)"
  )
  const refusedSpans = await queryPrometheus(
    "sum(otelcol_receiver_refused_spans_total)"
  )
  const failedExports = await queryPrometheus(
    "sum(otelcol_exporter_send_failed_spans_total)"
  )
  assert(acceptedSpans.length > 0, "Collector has not accepted any spans")
  console.log(
    `collector accepted=${acceptedSpans[0].value[1]} refused=${refusedSpans[0]?.value[1] ?? "0"} export_failed=${failedExports[0]?.value[1] ?? "0"}`
  )

  await request(`${gateway}/v1/telemetry/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resourceSpans: [] }),
  })
  console.log("browser_otlp_proxy=200")

  const dependencies = [
    ["nats", "http://127.0.0.1:8222/healthz?js-enabled-only=true"],
    ["voicevox", "http://127.0.0.1:50021/version"],
    ["seaweedfs-filer", "http://127.0.0.1:8333/status"],
    ["seaweedfs-master", "http://127.0.0.1:9333/cluster/status"],
  ]
  for (const [name, url] of dependencies) {
    await request(url)
    console.log(`dependency=${name} status=200`)
  }

  const traceId = process.env.OBSERVABILITY_TRACE_ID
  if (traceId !== undefined) {
    const trace = await grafanaRequest(
      `/api/datasources/proxy/uid/tempo/api/traces/${encodeURIComponent(traceId)}`
    )
    assert(trace.batches?.length > 0, `Tempo trace has no batches: ${traceId}`)
    const now = Math.floor(Date.now() / 1_000)
    const logParams = new URLSearchParams({
      query: `{service_name=~".+"} | trace_id = "${traceId}"`,
      start: String((now - 86_400) * 1_000_000_000),
      end: String(now * 1_000_000_000),
      limit: "100",
    })
    const logs = await grafanaRequest(
      `/api/datasources/proxy/uid/loki/loki/api/v1/query_range?${logParams.toString()}`
    )
    assert(
      logs.data?.result?.length > 0,
      `No Loki log carries trace_id=${traceId}`
    )
    const metrics = await queryPrometheus(
      'traces_spanmetrics_calls_total{service_name=~".+"}'
    )
    assert(
      metrics.length > 0,
      "No span metrics are available for trace correlation"
    )
    const exemplars = await queryPrometheusExemplars(
      'traces_spanmetrics_calls_total{service_name=~".+"}',
      now - 86_400,
      now
    )
    const exemplarTraceIds = new Set(
      exemplars.flatMap((series) =>
        (series.exemplars ?? [])
          .map((exemplar) => exemplar.labels?.trace_id)
          .filter((value) => typeof value === "string")
      )
    )
    assert(
      exemplarTraceIds.has(traceId),
      `No Prometheus exemplar carries trace_id=${traceId}`
    )
    console.log(
      `trace_id=${traceId} tempo=batches:${trace.batches.length} loki=streams:${logs.data.result.length} prometheus=spanmetrics:${metrics.length} exemplars:${exemplarTraceIds.size}`
    )
  } else {
    console.log(
      "trace_correlation=skipped (set OBSERVABILITY_TRACE_ID after a real service flow)"
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
