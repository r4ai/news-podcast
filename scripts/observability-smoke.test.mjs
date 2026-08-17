import assert from "node:assert/strict"
import test from "node:test"

import {
  request,
  waitForPrometheusResult,
  waitForSyntheticServiceGraph,
} from "./observability-smoke.mjs"

test("bounds every observability HTTP probe", async () => {
  await assert.rejects(
    request(
      "http://observability.test/health",
      {},
      {
        timeoutMillis: 1,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () => reject(init.signal.reason),
              { once: true }
            )
          }),
      }
    ),
    (error) => error?.name === "TimeoutError"
  )
})

test("waits for eventually consistent Prometheus series", async () => {
  let attempts = 0
  const result = await waitForPrometheusResult(
    async () => {
      attempts += 1
      return attempts === 3 ? [{ value: ["0", "1"] }] : []
    },
    { intervalMillis: 0, timeoutMillis: 100 }
  )

  assert.equal(attempts, 3)
  assert.deepEqual(result, [{ value: ["0", "1"] }])
})

test("fails after the Prometheus wait budget expires", async () => {
  await assert.rejects(
    waitForPrometheusResult(async () => [], {
      intervalMillis: 0,
      timeoutMillis: 1,
    }),
    /Prometheus series did not become available within 1ms/
  )
})

test("exports a synthetic trace before waiting for its service graph edge", async () => {
  const calls = []

  const result = await waitForSyntheticServiceGraph({
    sendTrace: async () => {
      calls.push("send")
      return { traceId: "0123456789abcdef0123456789abcdef" }
    },
    query: async () => {
      calls.push("query")
      return [{ value: ["0", "1"] }]
    },
    waitOptions: { intervalMillis: 0, timeoutMillis: 100 },
  })

  assert.deepEqual(calls, ["send", "query"])
  assert.equal(result.traceId, "0123456789abcdef0123456789abcdef")
  assert.deepEqual(result.edges, [{ value: ["0", "1"] }])
})
