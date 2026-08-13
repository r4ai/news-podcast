import { describe, expect, it, vi } from "vitest"

import { makeGatewayTelemetryProxy } from "./telemetry-proxy.js"

describe("Gateway browser telemetry proxy", () => {
  it("maps browser OTLP paths to the configured Collector origin", async () => {
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.toString()).toBe("http://otel-collector:4318/v1/traces")
      expect(init?.method).toBe("POST")
      const headers = new Headers(init?.headers)
      expect(headers.get("content-type")).toBe("application/json")
      expect(await new Response(init?.body).text()).toBe('{"resourceSpans":[]}')
      return Response.json({ ok: true }, { status: 200 })
    })
    const next = vi.fn(async () => Response.json({ route: "gateway" }))
    const proxy = makeGatewayTelemetryProxy({
      upstream: new URL("http://otel-collector:4318"),
      timeoutMillis: 100,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      fetch: fetch as never,
      next,
    })

    const response = await proxy(
      new Request("http://gateway/v1/telemetry/traces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"resourceSpans":[]}',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })

  it("keeps ordinary Gateway routes unchanged", async () => {
    const next = vi.fn(async () => Response.json({ route: "gateway" }))
    const proxy = makeGatewayTelemetryProxy({
      upstream: new URL("http://otel-collector:4318"),
      timeoutMillis: 100,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      fetch: vi.fn() as never,
      next,
    })

    const response = await proxy(new Request("http://gateway/health"))

    expect(await response.json()).toEqual({ route: "gateway" })
    expect(next).toHaveBeenCalledOnce()
  })

  it("rejects unsupported methods and oversized bodies before the Collector", async () => {
    const fetch = vi.fn()
    const proxy = makeGatewayTelemetryProxy({
      upstream: new URL("http://otel-collector:4318"),
      timeoutMillis: 100,
      maximumRequestBytes: 8,
      maximumResponseBytes: 1024,
      fetch: fetch as never,
      next: vi.fn(),
    })

    const methodResponse = await proxy(
      new Request("http://gateway/v1/telemetry/logs")
    )
    const bodyResponse = await proxy(
      new Request("http://gateway/v1/telemetry/metrics", {
        method: "POST",
        body: "123456789",
      })
    )

    expect(methodResponse.status).toBe(405)
    expect(bodyResponse.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
})
