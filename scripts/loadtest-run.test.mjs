import { test } from "node:test"
import assert from "node:assert/strict"
import process from "node:process"

import {
  capacityStages,
  createRepresentativeTraceArtifact,
  evaluateSummary,
  parseArgs,
  runProcess,
  shouldSkipFakeControl,
} from "./loadtest-run.mjs"

const summary = (overrides = {}) => ({
  metrics: {
    http_req_failed: { values: { rate: 0 } },
    loadtest_api_error: { values: { rate: 0 } },
    loadtest_api_latency: { values: { "p(95)": 100, "p(99)": 200 } },
    loadtest_job_enqueue_latency: { values: { "p(95)": 100 } },
    loadtest_job_enqueue_success: { values: { rate: 1 } },
    loadtest_job_success: { values: { rate: 1 } },
    loadtest_job_terminal: { values: { rate: 1 } },
    loadtest_job_completion: { values: { "p(95)": 1_000 } },
    loadtest_owner_isolation_checks: { values: { count: 1 } },
    loadtest_owner_mismatch: { values: { rate: 0 } },
    loadtest_chaos_expected_terminal: { values: { rate: 1 } },
    loadtest_chaos_publication_checks: { values: { count: 1 } },
    loadtest_chaos_publication_leak: { values: { rate: 0 } },
    ...overrides,
  },
})

test("parseArgs parses flags and boolean switches", () => {
  assert.deepEqual(
    parseArgs(["--mode", "capacity", "--start", "--duration", "30s"]),
    {
      mode: "capacity",
      start: true,
      duration: "30s",
    }
  )
})

test("skip fake control accepts the documented environment variable", () => {
  assert.equal(shouldSkipFakeControl({}, {}), false)
  assert.equal(
    shouldSkipFakeControl({}, { LOADTEST_SKIP_FAKE_CONTROL: "true" }),
    true
  )
  assert.equal(
    shouldSkipFakeControl({}, { LOADTEST_SKIP_FAKE_CONTROL: "false" }),
    false
  )
  assert.equal(shouldSkipFakeControl({ "skip-fake-control": true }, {}), true)
})

test("representative trace artifact records collection status", () => {
  const artifact = createRepresentativeTraceArtifact({
    status: "not-configured",
    source: null,
    query: '{ resource.service.name = "gateway" }',
    start: 1,
    end: 2,
    reason: "Grafana URL is not configured",
  })
  assert.deepEqual(artifact, {
    status: "not-configured",
    source: null,
    query: '{ resource.service.name = "gateway" }',
    window: { start: 1, end: 2 },
    collectedAt: artifact.collectedAt,
    traces: [],
    reason: "Grafana URL is not configured",
  })
})

test("capacity stages use the planned ramp", () => {
  assert.deepEqual(
    capacityStages("3m").map(({ apiRate, jobRate }) => [apiRate, jobRate]),
    [
      [2, 0.1],
      [5, 0.25],
      [10, 0.5],
      [20, 1],
      [40, 1],
    ]
  )
})

test("evaluateSummary accepts a healthy capacity result", () => {
  const result = evaluateSummary(summary(), "capacity")
  assert.equal(result.passed, true)
  assert.deepEqual(result.failures, [])
})

test("evaluateSummary reports missing or slow metrics", () => {
  const result = evaluateSummary(
    summary({
      loadtest_api_latency: { values: { "p(95)": 2_100, "p(99)": 5_100 } },
      loadtest_job_success: { values: { rate: 0.9 } },
      loadtest_owner_isolation_checks: undefined,
      loadtest_owner_mismatch: undefined,
    }),
    "capacity"
  )
  assert.equal(result.passed, false)
  assert.deepEqual(result.failures, [
    "api p95=2100",
    "api p99=5100",
    "job success rate=0.9",
    "owner isolation checks=missing",
    "owner mismatch rate=missing",
  ])
})

test("chaos evaluation does not require every job to succeed", () => {
  const result = evaluateSummary(
    summary({ loadtest_job_success: { values: { rate: 0 } } }),
    "chaos"
  )
  assert.equal(result.passed, true)
})

test("invalid provider chaos rejects unexpected publication", () => {
  const result = evaluateSummary(
    summary({
      loadtest_chaos_expected_terminal: { values: { rate: 0.9 } },
      loadtest_chaos_publication_leak: { values: { rate: 1 } },
    }),
    "chaos",
    "invalid-audio"
  )
  assert.equal(result.passed, false)
  assert.deepEqual(result.failures, [
    "chaos expected terminal rate=0.9",
    "chaos publication leak rate=1",
  ])
})

test("runProcess terminates the child when its signal is aborted", async () => {
  const controller = new AbortController()
  const child = runProcess(
    process.execPath,
    ["--input-type=module", "-e", "await new Promise(() => {})"],
    { signal: controller.signal, stdio: "ignore" }
  )
  controller.abort()
  const result = await child
  assert.notEqual(result.exitCode, 0)
})
