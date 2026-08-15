import assert from "node:assert/strict"
import test from "node:test"

import { waitForPrometheusResult } from "./observability-smoke.mjs"

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
