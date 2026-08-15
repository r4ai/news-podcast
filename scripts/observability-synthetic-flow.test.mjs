import assert from "node:assert/strict"
import test from "node:test"

import { createSyntheticTracePayload } from "./observability-synthetic-flow.mjs"

test("creates a parent-linked client/server trace for the service graph", () => {
  const payload = createSyntheticTracePayload({
    traceId: "a".repeat(32),
    clientSpanId: "b".repeat(16),
    serverSpanId: "c".repeat(16),
    startTimeUnixNano: "1000000000",
    endTimeUnixNano: "1010000000",
  })

  assert.equal(payload.resourceSpans.length, 2)
  const [clientResource, serverResource] = payload.resourceSpans
  const client = clientResource.scopeSpans[0].spans[0]
  const server = serverResource.scopeSpans[0].spans[0]

  assert.equal(
    clientResource.resource.attributes[0].value.stringValue,
    "ci.synthetic.client"
  )
  assert.equal(
    serverResource.resource.attributes[0].value.stringValue,
    "ci.synthetic.server"
  )
  assert.equal(client.kind, 3)
  assert.equal(server.kind, 2)
  assert.equal(client.traceId, server.traceId)
  assert.equal(server.parentSpanId, client.spanId)
})
