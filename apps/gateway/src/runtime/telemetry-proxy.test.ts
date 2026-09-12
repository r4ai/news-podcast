import { gzipSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"

import { makeGatewayTelemetryProxy } from "./telemetry-proxy.js"

const payload = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "episode-production" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "forged-scope" },
          logRecords: [
            {
              body: { stringValue: "browser.error" },
              timeUnixNano: "1750000000000000000",
              severityNumber: 24,
              attributes: [
                { key: "authorization", value: { stringValue: "secret" } },
              ],
            },
          ],
        },
      ],
    },
  ],
}
const request = (
  body: string | Uint8Array = JSON.stringify(payload),
  headers: Record<string, string> = {},
  path = "logs"
) =>
  new Request(`http://gateway/v1/telemetry/${path}?ignored=secret`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body as BodyInit,
  })
const setup = (
  options: Partial<Parameters<typeof makeGatewayTelemetryProxy>[0]> = {}
) => {
  const forwarded: { target: string; headers: Headers; body: unknown }[] = []
  const proxy = makeGatewayTelemetryProxy({
    upstream: new URL("http://otel-collector:4319"),
    timeoutMillis: 100,
    maximumRequestBytes: 1_048_576,
    maximumResponseBytes: 1024,
    resolveOwner: async () => "owner-a",
    fetch: async (url, init) => {
      forwarded.push({
        target: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({}, { headers: { "set-cookie": "secret" } })
    },
    next: async () => Response.json({ route: "gateway" }),
    ...options,
  })
  return { proxy, forwarded }
}

describe("Gateway browser telemetry proxy", () => {
  it.each(["logs", "traces", "metrics"])(
    "never forwards unauthenticated %s",
    async (path) => {
      const { proxy, forwarded } = setup({
        resolveOwner: async () => undefined,
      })
      expect(
        (
          await proxy(
            request(
              JSON.stringify(payload).replace(
                "browser.error",
                "FORGED_LOG_BODY"
              ),
              {},
              path
            )
          )
        ).status
      ).toBe(401)
      expect(forwarded).toEqual([])
    }
  )

  it("rebuilds authenticated JSON with fixed browser identity and without private headers or query", async () => {
    const { proxy, forwarded } = setup()
    const response = await proxy(
      request(undefined, {
        cookie: "private",
        authorization: "private",
        "x-owner-id": "spoofed",
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.has("set-cookie")).toBe(false)
    expect(forwarded[0]?.target).toBe("http://otel-collector:4319/v1/logs")
    const names: string[] = []
    forwarded[0]!.headers.forEach((_, key) => names.push(key))
    expect(names).toEqual(["content-type"])
    expect(JSON.stringify(forwarded[0]?.body)).toContain("news-podcast-web")
    for (const forbidden of [
      "episode-production",
      "forged-scope",
      "secret",
      "authorization",
    ])
      expect(JSON.stringify(forwarded[0]?.body)).not.toContain(forbidden)
  })

  it.each([
    ["gzip", gzipSync(JSON.stringify(payload)), 200],
    ["identity", "{", 400],
    ["gzip", new Uint8Array([1, 2, 3]), 400],
    ["gzip", gzipSync(JSON.stringify(payload)).subarray(0, 12), 400],
    ["gzip, gzip", "{}", 415],
    ["br", "{}", 415],
    ["gzip", gzipSync(" ".repeat(100_000)), 413],
    ["identity", " ".repeat(262_145), 413],
  ] as const)(
    "bounds/validates encoding %s (%#)",
    async (encoding, body, status) => {
      const { proxy, forwarded } = setup()
      expect(
        (await proxy(request(body, { "content-encoding": encoding }))).status
      ).toBe(status)
      expect(forwarded.length).toBe(status === 200 ? 1 : 0)
    }
  )

  it("bounds decoded bytes independently of compressed bytes", async () => {
    const { proxy, forwarded } = setup({ maximumRequestBytes: 300 })
    expect(
      (
        await proxy(
          request(gzipSync(JSON.stringify(payload)), {
            "content-encoding": "gzip",
          })
        )
      ).status
    ).toBe(413)
    expect(forwarded).toEqual([])
  })

  it.each(["application/x-protobuf", "text/plain"])(
    "rejects alternate wire format %s",
    async (type) => {
      const { proxy, forwarded } = setup()
      expect(
        (await proxy(request("{}", { "content-type": type }))).status
      ).toBe(415)
      expect(forwarded).toEqual([])
    }
  )

  it("fails closed on session failure and session deadline", async () => {
    for (const resolveOwner of [
      async () => {
        throw new Error("identity down")
      },
      () => new Promise<string>(() => {}),
    ]) {
      const { proxy, forwarded } = setup({ resolveOwner, timeoutMillis: 10 })
      expect((await proxy(request())).status).toBe(503)
      expect(forwarded).toEqual([])
    }
  })

  it("bounds slow streaming request bodies and Collector replies", async () => {
    const { proxy, forwarded } = setup({ timeoutMillis: 10 })
    const slow = new Request("http://gateway/v1/telemetry/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit)
    expect((await proxy(slow)).status).toBe(503)
    expect(forwarded).toEqual([])
    const huge = setup({ fetch: async () => new Response("x".repeat(1025)) })
    expect((await huge.proxy(request())).status).toBe(502)
  })

  it("shares owner budget across signals and ignores forged owner/IP headers", async () => {
    const { proxy, forwarded } = setup()
    for (let i = 0; i < 30; i++)
      expect((await proxy(request(), "127.0.0.1")).status).toBe(200)
    const response = await proxy(
      request(
        "{}",
        { "x-owner-id": "new", "x-forwarded-for": "1.2.3.4" },
        "traces"
      ),
      "127.0.0.1"
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(forwarded).toHaveLength(30)
  })

  it("charges unauthenticated IP attempts before the session resolver", async () => {
    const resolveOwner = vi.fn(async () => undefined)
    const { proxy } = setup({ resolveOwner })
    for (let i = 0; i < 120; i++)
      expect(
        (
          await proxy(
            request(undefined, { "x-forwarded-for": String(i) }),
            "same-peer"
          )
        ).status
      ).toBe(401)
    expect((await proxy(request(), "same-peer")).status).toBe(429)
    expect(resolveOwner).toHaveBeenCalledTimes(120)
  })

  it("keeps ordinary routes and rejects unsupported methods/cross-site submissions", async () => {
    const { proxy, forwarded } = setup()
    expect(
      await (await proxy(new Request("http://gateway/health"))).json()
    ).toEqual({ route: "gateway" })
    expect(
      (await proxy(new Request("http://gateway/v1/telemetry/logs"))).status
    ).toBe(405)
    expect(
      (await proxy(request(undefined, { "sec-fetch-site": "cross-site" })))
        .status
    ).toBe(403)
    expect(forwarded).toEqual([])
  })
})
