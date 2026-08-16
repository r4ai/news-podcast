#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("../", import.meta.url))
const defaultK6Image = process.env.K6_IMAGE ?? "grafana/k6:0.55.0"
const normalProfiles = [
  { name: "ramp-2", apiRate: 2, jobRate: 0.1 },
  { name: "ramp-5", apiRate: 5, jobRate: 0.25 },
  { name: "ramp-10", apiRate: 10, jobRate: 0.5 },
  { name: "ramp-20", apiRate: 20, jobRate: 1 },
  { name: "ramp-40", apiRate: 40, jobRate: 1 },
]
const chaosProfiles = [
  "slow",
  "timeout",
  "http-429",
  "http-5xx",
  "malformed",
  "incomplete",
  "invalid-audio",
  "mixed",
]
const invalidProviderProfiles = new Set([
  "malformed",
  "incomplete",
  "invalid-audio",
])

export const parseArgs = (input) => {
  const result = {}
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index]
    if (!token.startsWith("--")) continue
    const name = token.slice(2)
    if (name === "help") {
      result.help = true
      continue
    }
    const next = input[index + 1]
    if (next === undefined || next.startsWith("--")) result[name] = true
    else {
      result[name] = next
      index += 1
    }
  }
  return result
}

const isTrue = (value) =>
  typeof value === "string" && value.trim().toLowerCase() === "true"

export const shouldSkipFakeControl = (args, env = process.env) =>
  args["skip-fake-control"] === true || isTrue(env.LOADTEST_SKIP_FAKE_CONTROL)

export const resolveGrafanaToken = (args, env = process.env) => {
  if (Object.hasOwn(args, "grafana-token"))
    throw new Error(
      "Grafana tokens must not be passed on the command line; use LOADTEST_GRAFANA_TOKEN"
    )
  return env.LOADTEST_GRAFANA_TOKEN ?? env.GRAFANA_API_TOKEN
}

const metricValue = (summary, name, key) =>
  summary?.metrics?.[name]?.values?.[key]

export const evaluateSummary = (summary, mode, profile) => {
  const observations = {
    httpFailureRate: metricValue(summary, "http_req_failed", "rate"),
    apiErrorRate: metricValue(summary, "loadtest_api_error", "rate"),
    apiP95: metricValue(summary, "loadtest_api_latency", "p(95)"),
    apiP99: metricValue(summary, "loadtest_api_latency", "p(99)"),
    enqueueP95: metricValue(summary, "loadtest_job_enqueue_latency", "p(95)"),
    enqueueSuccessRate: metricValue(
      summary,
      "loadtest_job_enqueue_success",
      "rate"
    ),
    jobSuccessRate: metricValue(summary, "loadtest_job_success", "rate"),
    jobTerminalRate: metricValue(summary, "loadtest_job_terminal", "rate"),
    jobCompletionP95: metricValue(summary, "loadtest_job_completion", "p(95)"),
    ownerIsolationChecks: metricValue(
      summary,
      "loadtest_owner_isolation_checks",
      "count"
    ),
    ownerMismatchRate: metricValue(summary, "loadtest_owner_mismatch", "rate"),
    chaosExpectedTerminalRate: metricValue(
      summary,
      "loadtest_chaos_expected_terminal",
      "rate"
    ),
    chaosPublicationChecks: metricValue(
      summary,
      "loadtest_chaos_publication_checks",
      "count"
    ),
    chaosPublicationLeakRate: metricValue(
      summary,
      "loadtest_chaos_publication_leak",
      "rate"
    ),
  }
  const checks = [
    [
      "http failure rate",
      observations.httpFailureRate,
      (value) => value < 0.01,
    ],
    ["api error rate", observations.apiErrorRate, (value) => value < 0.01],
    ["api p95", observations.apiP95, (value) => value < 2_000],
    ["api p99", observations.apiP99, (value) => value < 5_000],
    ["enqueue p95", observations.enqueueP95, (value) => value < 2_000],
    [
      "enqueue success rate",
      observations.enqueueSuccessRate,
      (value) => value > 0.99,
    ],
  ]
  if (mode !== "smoke" && mode !== "chaos") {
    checks.push(
      [
        "job success rate",
        observations.jobSuccessRate,
        (value) => value > 0.99,
      ],
      [
        "job completion p95",
        observations.jobCompletionP95,
        (value) => value < 60_000,
      ]
    )
  } else if (mode === "chaos") {
    checks.push(
      [
        "job terminal rate",
        observations.jobTerminalRate,
        (value) => value > 0.99,
      ],
      [
        "chaos expected terminal rate",
        observations.chaosExpectedTerminalRate,
        (value) => value > 0.99,
      ]
    )
    if (invalidProviderProfiles.has(profile))
      checks.push(
        [
          "chaos publication checks",
          observations.chaosPublicationChecks,
          (value) => value > 0,
        ],
        [
          "chaos publication leak rate",
          observations.chaosPublicationLeakRate,
          (value) => value < 0.001,
        ]
      )
  }
  if (mode !== "smoke") {
    checks.push(
      [
        "owner isolation checks",
        observations.ownerIsolationChecks,
        (value) => value > 0,
      ],
      [
        "owner mismatch rate",
        observations.ownerMismatchRate,
        (value) => value < 0.001,
      ]
    )
  }
  const failures = checks
    .filter(([, value, predicate]) => value === undefined || !predicate(value))
    .map(([name, value]) => `${name}=${value ?? "missing"}`)
  return { passed: failures.length === 0, failures, observations }
}

export const capacityStages = (duration = "180s") =>
  normalProfiles.map((stage) => ({ ...stage, duration }))

export const createRepresentativeTraceArtifact = ({
  status,
  source,
  query,
  start,
  end,
  traces = [],
  reason,
}) => ({
  status,
  source,
  query,
  window: { start, end },
  collectedAt: new Date().toISOString(),
  traces,
  ...(reason === undefined ? {} : { reason }),
})

const collectRepresentativeTraces = async (args) => {
  const grafanaUrl =
    args["grafana-url"] ??
    process.env.LOADTEST_GRAFANA_URL ??
    process.env.GRAFANA_URL
  const tempoUrl = args["tempo-url"] ?? process.env.LOADTEST_TEMPO_URL
  const query =
    args["trace-query"] ??
    process.env.LOADTEST_TRACE_QUERY ??
    '{ resource.service.name = "gateway" }'
  const end = Date.now()
  const start =
    end -
    Number(
      args["trace-lookback-ms"] ??
        process.env.LOADTEST_TRACE_LOOKBACK_MS ??
        3_600_000
    )

  if (grafanaUrl === undefined && tempoUrl === undefined)
    return createRepresentativeTraceArtifact({
      status: "not-configured",
      source: null,
      query,
      start,
      end,
      reason:
        "Set LOADTEST_GRAFANA_URL or LOADTEST_TEMPO_URL to collect representative traces",
    })

  const endpoint = `${(
    tempoUrl ?? `${grafanaUrl}/api/datasources/proxy/uid/tempo`
  ).replace(/\/$/, "")}/api/search`
  const params = new URLSearchParams({
    limit: "5",
    start: String(Math.floor(start / 1_000)),
    end: String(Math.floor(end / 1_000)),
    q: query,
  })
  const headers = {}
  const token = resolveGrafanaToken(args)
  if (token) headers.authorization = `Bearer ${token}`

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      headers,
    })
    if (!response.ok)
      return createRepresentativeTraceArtifact({
        status: "unavailable",
        source: endpoint,
        query,
        start,
        end,
        reason: `Trace search failed: HTTP ${response.status}`,
      })
    const payload = await response.json()
    const traces = Array.isArray(payload?.traces)
      ? payload.traces
      : Array.isArray(payload?.data?.traces)
        ? payload.data.traces
        : []
    return createRepresentativeTraceArtifact({
      status: traces.length > 0 ? "collected" : "empty",
      source: endpoint,
      query,
      start,
      end,
      traces,
      ...(traces.length === 0
        ? { reason: "Trace search returned no traces" }
        : {}),
    })
  } catch (error) {
    return createRepresentativeTraceArtifact({
      status: "unavailable",
      source: endpoint,
      query,
      start,
      end,
      reason: error instanceof Error ? error.message : "Trace search failed",
    })
  }
}

export const runProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.stdio ?? "inherit",
    })
    const onAbort = () => {
      try {
        child.kill("SIGTERM")
      } catch {
        // The child may have exited between the abort and kill calls.
      }
    }
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
    }
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener("abort", onAbort, { once: true })
    child.once("error", (error) => {
      cleanup()
      reject(error)
    })
    child.once("close", (code, signal) => {
      cleanup()
      resolve({ exitCode: code ?? 1, signal })
    })
  })

const required = (value, name) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(
      `--${name} or LOADTEST_${name.toUpperCase().replaceAll("-", "_")} is required`
    )
  return value
}

const requestProfile = async (url, profile, args, signal) => {
  const token =
    args["fake-control-token"] ?? process.env.LOADTEST_FAKE_CONTROL_TOKEN
  if (typeof token !== "string" || token.trim() === "")
    throw new Error(
      "LOADTEST_FAKE_CONTROL_TOKEN is required unless LOADTEST_SKIP_FAKE_CONTROL=true"
    )
  const response = await fetch(`${url}/control/profile`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-loadtest-admin-token": token,
    },
    body: JSON.stringify({
      profile,
      faultRate: Number(
        args["fault-rate"] ?? process.env.LOADTEST_FAULT_RATE ?? 0.1
      ),
      delayMs: Number(
        args["delay-ms"] ?? process.env.LOADTEST_FAULT_DELAY_MS ?? 750
      ),
      timeoutMs: Number(
        args["timeout-ms"] ?? process.env.LOADTEST_FAULT_TIMEOUT_MS ?? 4_000
      ),
      seed: Number(args.seed ?? process.env.LOADTEST_FAULT_SEED ?? 1),
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok)
    throw new Error(
      `provider profile ${profile} failed: HTTP ${response.status}`
    )
}

const setProfile = async (profile, args, signal) => {
  if (shouldSkipFakeControl(args)) return
  await Promise.all([
    requestProfile(
      args["fake-openai-url"] ??
        process.env.LOADTEST_FAKE_OPENAI_URL ??
        "http://127.0.0.1:18080",
      profile,
      args,
      signal
    ),
    requestProfile(
      args["fake-voicevox-url"] ??
        process.env.LOADTEST_FAKE_VOICEVOX_URL ??
        "http://127.0.0.1:18081",
      profile,
      args,
      signal
    ),
  ])
}

const runK6 = async ({
  name,
  mode,
  apiRate,
  jobRate,
  duration,
  profile,
  signal,
  args,
  artifactDir,
}) => {
  const sessionsFile = path.resolve(
    args["sessions-file"] ?? process.env.LOADTEST_SESSIONS_FILE ?? ""
  )
  const baseUrl = required(
    args["base-url"] ?? process.env.LOADTEST_BASE_URL,
    "base-url"
  )
  if (!sessionsFile || sessionsFile === path.resolve(root))
    throw new Error("--sessions-file or LOADTEST_SESSIONS_FILE is required")
  await mkdir(artifactDir, { recursive: true })
  const summaryPath = path.join(artifactDir, "k6-summary.json")
  const scriptDir = path.join(root, "loadtests/k6")
  const image = args["k6-image"] ?? defaultK6Image
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
  const dockerArgs = [
    "run",
    "--rm",
    "--user",
    user,
    "--network",
    "host",
    "-e",
    `LOADTEST_BASE_URL=${baseUrl}`,
    "-e",
    `LOADTEST_MODE=${mode}`,
    "-e",
    `API_RATE=${apiRate}`,
    "-e",
    `JOB_RATE=${jobRate}`,
    ...(profile === undefined ? [] : ["-e", `CHAOS_PROFILE=${profile}`]),
    "-e",
    `STAGE_DURATION=${duration}`,
    "-e",
    "LOADTEST_SESSIONS_FILE=/data/sessions.json",
    "-v",
    `${scriptDir}:/scripts:ro`,
    "-v",
    `${sessionsFile}:/data/sessions.json:ro`,
    "-v",
    `${path.resolve(artifactDir)}:/artifacts`,
    image,
    "run",
    "--summary-export=/artifacts/k6-summary.json",
    "/scripts/load.js",
  ]
  const processResult = await runProcess("docker", dockerArgs, { signal })
  let summary
  try {
    summary = JSON.parse(await readFile(summaryPath, "utf8"))
  } catch {
    summary = {}
  }
  const evaluation = evaluateSummary(summary, mode, profile)
  const result = {
    name,
    mode,
    apiRate,
    jobRate,
    duration,
    ...(profile === undefined ? {} : { profile }),
    exitCode: processResult.exitCode,
    ...evaluation,
  }
  await writeFile(
    path.join(artifactDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  )
  return {
    ...result,
    passed: processResult.exitCode === 0 && evaluation.passed,
  }
}

const compose = [
  "compose",
  "--project-name",
  process.env.LOADTEST_COMPOSE_PROJECT ?? "news-podcast-loadtest",
  "-f",
  "compose.yaml",
  "-f",
  "infra/loadtest/compose.yaml",
]

const startStack = async () => {
  const result = await runProcess("docker", [
    ...compose,
    "up",
    "--detach",
    "--build",
    "--wait",
  ])
  if (result.exitCode !== 0) throw new Error("load-test stack failed to start")
}

const healthCheck = async (baseUrl) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`)
  if (!response.ok)
    throw new Error(`Gateway health failed: HTTP ${response.status}`)
}

const createArtifactRoot = (args) => {
  const runId =
    args["run-id"] ?? new Date().toISOString().replaceAll(/[:.]/g, "-")
  return path.resolve(args.artifacts ?? path.join("artifacts/loadtest", runId))
}

const interruptionError = () => {
  const error = new Error("load test interrupted")
  error.code = "LOADTEST_INTERRUPTED"
  return error
}

const waitFor = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    let timer
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      cleanup()
      reject(interruptionError())
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: node scripts/loadtest-run.mjs --mode smoke|capacity|soak|spike|chaos --base-url URL --sessions-file FILE [--start]"
    )
    return
  }
  const mode = args.mode ?? "capacity"
  if (!["smoke", "capacity", "soak", "spike", "chaos"].includes(mode))
    throw new Error(`unsupported load-test mode: ${mode}`)
  if (args.start === true) await startStack()
  const baseUrl = required(
    args["base-url"] ?? process.env.LOADTEST_BASE_URL,
    "base-url"
  )
  await healthCheck(baseUrl)
  const artifactRoot = createArtifactRoot(args)
  await mkdir(artifactRoot, { recursive: true })
  const manifest = {
    runId: path.basename(artifactRoot),
    mode,
    baseUrl,
    createdAt: new Date().toISOString(),
    k6Image: args["k6-image"] ?? defaultK6Image,
  }
  await writeFile(
    path.join(artifactRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  )

  const results = []
  if (mode === "smoke") {
    await setProfile("normal", args)
    results.push(
      await runK6({
        name: "smoke",
        mode,
        apiRate: 1,
        jobRate: 0.1,
        duration: "10s",
        args,
        artifactDir: path.join(artifactRoot, "smoke"),
      })
    )
  } else if (mode === "capacity") {
    for (const stage of capacityStages(
      args.duration ?? process.env.LOADTEST_STAGE_DURATION ?? "180s"
    )) {
      await setProfile("normal", args)
      const result = await runK6({
        ...stage,
        mode,
        args,
        artifactDir: path.join(artifactRoot, stage.name),
      })
      results.push(result)
      if (!result.passed) break
    }
  } else if (mode === "soak" || mode === "spike") {
    const apiRate = Number(
      args["api-rate"] ?? process.env.LOADTEST_API_RATE ?? 2
    )
    const jobRate = Number(
      args["job-rate"] ?? process.env.LOADTEST_JOB_RATE ?? 0.1
    )
    const factor =
      mode === "spike"
        ? Number(args.factor ?? process.env.LOADTEST_SPIKE_FACTOR ?? 2)
        : 1
    const duration =
      args.duration ??
      process.env[
        mode === "spike" ? "LOADTEST_SPIKE_DURATION" : "LOADTEST_SOAK_DURATION"
      ] ??
      (mode === "spike" ? "60s" : "600s")
    await setProfile("normal", args)
    results.push(
      await runK6({
        name: mode,
        mode,
        apiRate: apiRate * factor,
        jobRate: jobRate * factor,
        duration,
        args,
        artifactDir: path.join(artifactRoot, mode),
      })
    )
  } else {
    const apiRate = Number(
      args["api-rate"] ?? process.env.LOADTEST_API_RATE ?? 2
    )
    const jobRate = Number(
      args["job-rate"] ?? process.env.LOADTEST_JOB_RATE ?? 0.1
    )
    const duration =
      args.duration ?? process.env.LOADTEST_STAGE_DURATION ?? "180s"
    const resetProviderProfile = async () => {
      try {
        await setProfile("normal", args)
      } catch (error) {
        console.error(
          `provider profile reset failed: ${error instanceof Error ? error.message : error}`
        )
      }
    }
    const interruptController = new AbortController()
    let interrupted = false
    const onInterrupt = () => {
      interrupted = true
      interruptController.abort()
    }
    process.once("SIGINT", onInterrupt)
    process.once("SIGTERM", onInterrupt)
    try {
      for (const profile of chaosProfiles) {
        await setProfile(profile, args, interruptController.signal)
        if (interrupted) throw interruptionError()
        results.push(
          await runK6({
            name: `chaos-${profile}`,
            mode,
            apiRate,
            jobRate,
            duration,
            profile,
            signal: interruptController.signal,
            args,
            artifactDir: path.join(artifactRoot, `chaos-${profile}`),
          })
        )
        if (interrupted) throw interruptionError()
      }
      await setProfile("normal", args, interruptController.signal)
      if (interrupted) throw interruptionError()
      const recoveryWait = Number(
        args["recovery-wait-ms"] ??
          process.env.LOADTEST_RECOVERY_WAIT_MS ??
          300_000
      )
      await waitFor(recoveryWait, interruptController.signal)
      results.push(
        await runK6({
          name: "recovery",
          mode: "capacity",
          apiRate,
          jobRate,
          duration: args["recovery-duration"] ?? "60s",
          signal: interruptController.signal,
          args,
          artifactDir: path.join(artifactRoot, "recovery"),
        })
      )
    } catch (error) {
      if (interrupted) throw interruptionError()
      throw error
    } finally {
      await resetProviderProfile()
      process.removeListener("SIGINT", onInterrupt)
      process.removeListener("SIGTERM", onInterrupt)
    }
    if (interrupted) throw interruptionError()
  }

  await writeFile(
    path.join(artifactRoot, "metrics.json"),
    `${JSON.stringify({ manifest, results }, null, 2)}\n`,
    "utf8"
  )
  const representativeTraces = await collectRepresentativeTraces(args)
  const passed = results.filter((result) => result.passed).length
  const report = [
    `# Load test report: ${manifest.runId}`,
    "",
    `- Mode: ${mode}`,
    `- Started: ${manifest.createdAt}`,
    `- Passed stages: ${passed}/${results.length}`,
    `- Representative traces: ${representativeTraces.status}`,
    "",
    "| Stage | API rate | Job rate | Result | Failures |",
    "|---|---:|---:|---|---|",
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.apiRate} | ${result.jobRate} | ${result.passed ? "PASS" : "FAIL"} | ${result.failures.join(", ") || "-"} |`
    ),
    "",
    "詳細なk6 metricは`k6-summary.json`と`metrics.json`を参照する。",
  ].join("\n")
  await writeFile(path.join(artifactRoot, "report.md"), `${report}\n`, "utf8")
  await writeFile(
    path.join(artifactRoot, "representative-traces.json"),
    `${JSON.stringify(representativeTraces, null, 2)}\n`,
    "utf8"
  )
  if (
    isTrue(process.env.LOADTEST_REQUIRE_TRACE_ARTIFACT) &&
    representativeTraces.status !== "collected"
  )
    process.exitCode = 1
  if (results.some((result) => !result.passed)) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = error?.code === "LOADTEST_INTERRUPTED" ? 130 : 1
  })
