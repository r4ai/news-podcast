#!/usr/bin/env node

import { randomBytes } from "node:crypto"
import { pathToFileURL } from "node:url"

const clientService = "ci.synthetic.client"
const serverService = "ci.synthetic.server"

const randomHex = (bytes) => randomBytes(bytes).toString("hex")

const stringAttribute = (key, value) => ({
  key,
  value: { stringValue: value },
})

const resource = (serviceName) => ({
  attributes: [
    stringAttribute("service.name", serviceName),
    stringAttribute("service.version", "ci"),
    stringAttribute("deployment.environment.name", "ci"),
  ],
})

export const createSyntheticTracePayload = ({
  traceId = randomHex(16),
  clientSpanId = randomHex(8),
  serverSpanId = randomHex(8),
  startTimeUnixNano = String(BigInt(Date.now()) * 1_000_000n),
  endTimeUnixNano = String(BigInt(startTimeUnixNano) + 10_000_000n),
} = {}) => ({
  resourceSpans: [
    {
      resource: resource(clientService),
      scopeSpans: [
        {
          scope: { name: "news-podcast-ci" },
          spans: [
            {
              traceId,
              spanId: clientSpanId,
              name: "ci.synthetic.client",
              kind: 3,
              startTimeUnixNano,
              endTimeUnixNano,
              attributes: [stringAttribute("server.address", serverService)],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
    {
      resource: resource(serverService),
      scopeSpans: [
        {
          scope: { name: "news-podcast-ci" },
          spans: [
            {
              traceId,
              spanId: serverSpanId,
              parentSpanId: clientSpanId,
              name: "ci.synthetic.server",
              kind: 2,
              startTimeUnixNano,
              endTimeUnixNano,
              attributes: [stringAttribute("http.request.method", "GET")],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ],
})

export const sendSyntheticTrace = async ({
  endpoint = process.env.OBSERVABILITY_OTLP_ENDPOINT ?? "http://127.0.0.1:4318",
  fetchImpl = globalThis.fetch,
  timeoutMillis = 10_000,
} = {}) => {
  const payload = createSyntheticTracePayload()
  const response = await fetchImpl(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMillis),
  })
  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(
      `OTLP synthetic trace export failed: ${response.status}: ${responseBody.slice(0, 300)}`
    )
  }
  return { traceId: payload.resourceSpans[0].scopeSpans[0].spans[0].traceId }
}

const main = async () => {
  const { traceId } = await sendSyntheticTrace()
  console.log(`synthetic_trace=sent trace_id=${traceId}`)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
