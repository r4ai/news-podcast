import { SpanKind, SpanStatusCode } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { describe, expect, it, vi } from "vitest"

import { createTracedFetch } from "./node-client-fetch.js"

describe("traced provider fetch", () => {
  it("records successful provider responses", async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const tracedFetch = createTracedFetch(
      {
        provider: "voicevox",
        operation: (url) => url.pathname.slice(1),
        fetcher: async () => new Response(null, { status: 204 }),
      },
      { tracer: provider.getTracer("test") }
    )

    await expect(
      tracedFetch("http://voicevox/speakers")
    ).resolves.toMatchObject({ status: 204 })
    expect(exporter.getFinishedSpans()[0]).toMatchObject({
      name: "provider.voicevox.speakers",
      kind: SpanKind.CLIENT,
      status: { code: SpanStatusCode.UNSET },
      attributes: {
        "provider.outcome": "succeeded",
        "http.request.method": "GET",
        "http.response.status_code": 204,
      },
    })
    await provider.shutdown()
  })

  it("records allowlisted client attributes and preserves caller headers", async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    let sentHeaders: Headers | undefined
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      sentHeaders = new Headers(init?.headers)
      return new Response("unavailable", { status: 503 })
    })
    const tracedFetch = createTracedFetch(
      {
        provider: "openai",
        operation: "responses",
        fetcher,
      },
      { tracer: provider.getTracer("test") }
    )

    const response = await tracedFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer private" },
    })

    expect(response.status).toBe(503)
    expect(sentHeaders?.get("authorization")).toBe("Bearer private")
    const [span] = exporter.getFinishedSpans()
    expect(span).toMatchObject({
      name: "provider.openai.responses",
      kind: SpanKind.CLIENT,
      status: { code: SpanStatusCode.ERROR },
      attributes: {
        "provider.name": "openai",
        "provider.operation": "responses",
        "provider.outcome": "error",
        "http.request.method": "POST",
        "http.response.status_code": 503,
      },
    })
    expect(span?.attributes).not.toHaveProperty("url.full")
    expect(span?.attributes).not.toHaveProperty(
      "http.request.header.authorization"
    )
    await provider.shutdown()
  })

  it("records sanitized network failures and preserves the original error", async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const failure = new TypeError(
      "request https://private.example failed with Bearer private-token"
    )
    const tracedFetch = createTracedFetch(
      {
        provider: "voicevox",
        operation: () => "synthesis",
        fetcher: () => Promise.reject(failure),
      },
      { tracer: provider.getTracer("test") }
    )

    await expect(
      tracedFetch("http://voicevox:50021/synthesis", { method: "POST" })
    ).rejects.toBe(failure)
    const [span] = exporter.getFinishedSpans()
    expect(span).toMatchObject({
      name: "provider.voicevox.synthesis",
      kind: SpanKind.CLIENT,
      status: { code: SpanStatusCode.ERROR },
      attributes: {
        "error.type": "TypeError",
        "provider.outcome": "error",
      },
    })
    expect(span?.events[0]?.attributes).toMatchObject({
      "exception.message": "TypeError",
      "exception.type": "Error",
    })
    await provider.shutdown()
  })
})
