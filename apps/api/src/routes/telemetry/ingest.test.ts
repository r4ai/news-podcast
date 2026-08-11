import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"

function telemetryRequest(
  origin = "https://app.example.com",
  contentLength = 1
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-protobuf",
      "Content-Length": String(contentLength),
      Origin: origin,
    },
    body: new Uint8Array([1]),
  }
}

describe("POST /v1/telemetry/{signal}", () => {
  it("forwards authenticated same-origin OTLP without exposing the collector", async () => {
    const forwarded: Array<{ signal: string; size: number }> = []
    const app = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry: async (signal, body) => {
        forwarded.push({ signal, size: body.byteLength })
      },
    })
    const response = await app.request("/v1/telemetry/traces", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
        Origin: "https://app.example.com",
      },
      body: new Uint8Array([1, 2, 3]),
    })

    expect(response.status).toBe(204)
    expect(forwarded).toEqual([{ signal: "traces", size: 3 }])
  })

  it("rejects unauthenticated, cross-origin, and oversized telemetry", async () => {
    const forwardTelemetry = async () => undefined
    const unauthenticated = await createApp({
      resolveOwner: async () => null,
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry,
    }).request("/v1/telemetry/logs", telemetryRequest())
    expect(unauthenticated.status).toBe(401)

    const protectedApp = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry,
    })
    const crossOrigin = await protectedApp.request(
      "/v1/telemetry/logs",
      telemetryRequest("https://other.example.com")
    )
    expect(crossOrigin.status).toBe(403)

    const oversized = await protectedApp.request(
      "/v1/telemetry/metrics",
      telemetryRequest("https://app.example.com", 256 * 1024 + 1)
    )
    expect(oversized.status).toBe(413)
  })

  it("rate limits telemetry per authenticated owner", async () => {
    const app = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry: async () => undefined,
    })
    for (let request = 0; request < 60; request += 1) {
      const response = await app.request(
        "/v1/telemetry/traces",
        telemetryRequest()
      )
      expect(response.status).toBe(204)
    }
    const limited = await app.request(
      "/v1/telemetry/traces",
      telemetryRequest()
    )
    expect(limited.status).toBe(429)
  })
})
