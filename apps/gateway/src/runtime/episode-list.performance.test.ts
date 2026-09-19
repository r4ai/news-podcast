import { createServer } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"

import type { GatewayPorts } from "../application/ports.js"
import { EPISODE_LIST_PAYLOAD_BUDGET_BYTES } from "../application/handlers/episode-list-metrics.js"
import { EpisodePageSchema } from "../contract.js"
import { makeGatewayWebHandler } from "./http.js"

/** Slow mobile model: 400 ms request/response latency, 1.28 Mbit/s downlink.
 * Actual loopback HTTP bytes, first-byte arrival and JSON parse are measured.
 * This isolates transport/serialization from live NATS/auth/database load.
 */
it("keeps 20 maximum-length episodes inside the mobile list budget", async () => {
  const fullPage = {
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: "題".repeat(500),
      script: "本".repeat(20_000),
      sources: [
        {
          url: "https://example.com/news",
          title: "典".repeat(500),
          sourceKind: "web",
        },
      ],
      createdAt: "2026-09-20T00:00:00.000Z",
    })),
    page: { hasMore: false },
  }
  const page = Schema.decodeUnknownSync(EpisodePageSchema)(fullPage)
  // An unexpected port call fails the request; only the list route is exercised.
  const ports = new Proxy(
    { listEpisodes: () => Effect.succeed(page) },
    {
      get: (target, key) =>
        key === "listEpisodes"
          ? target.listEpisodes
          : () => Effect.die(`Unexpected port ${String(key)}`),
    }
  ) as unknown as GatewayPorts
  const runtime = makeGatewayWebHandler(ports)
  const request = () => new Request("http://gateway.test/v1/episodes")
  await runtime.handler(request()) // Warm the HTTP layer, independently of measurement.
  const server = createServer(async (incoming, outgoing) => {
    try {
      const body =
        incoming.url === "/legacy"
          ? JSON.stringify(fullPage)
          : await (await runtime.handler(request())).text()
      const bytes = Buffer.from(body)
      await delay(400)
      outgoing.writeHead(200, {
        "content-type": "application/json",
        "content-length": bytes.length,
      })
      for (let offset = 0; offset < bytes.length; offset += 16_000) {
        outgoing.write(bytes.subarray(offset, offset + 16_000))
        if (offset + 16_000 < bytes.length) await delay(100)
      }
      outgoing.end()
    } catch (error) {
      outgoing.destroy(
        error instanceof Error ? error : new Error(String(error))
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("No HTTP address")
  const measure = async (path: string) => {
    const started = performance.now()
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
    const reader = response.body!.getReader()
    const first = await reader.read()
    const ttfbMillis = performance.now() - started
    const chunks: Uint8Array[] = first.value ? [first.value] : []
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
    }
    const bytes = Buffer.concat(chunks)
    const transferMillis = performance.now() - started
    const text = bytes.toString("utf8")
    const parseStarted = performance.now()
    const decoded = JSON.parse(text) as { items: unknown[] }
    const parseMillis = performance.now() - parseStarted
    expect(decoded.items).toHaveLength(20)
    return { bytes: bytes.length, ttfbMillis, transferMillis, parseMillis }
  }
  try {
    const legacy = await measure("/legacy")
    const summaries = await Promise.all([
      measure("/summary"),
      measure("/summary"),
      measure("/summary"),
    ])
    console.info(
      "episode-list mobile performance",
      JSON.stringify({
        profile: { latencyMillis: 400, bytesPerSecond: 160_000 },
        legacy,
        summaries,
      })
    )
    for (const summary of summaries) {
      expect(summary.bytes).toBeLessThanOrEqual(
        EPISODE_LIST_PAYLOAD_BUDGET_BYTES
      )
      expect(summary.bytes / legacy.bytes).toBeLessThan(0.04)
      expect(summary.ttfbMillis).toBeLessThan(1_500)
      expect(summary.transferMillis).toBeLessThan(2_000)
      expect(summary.transferMillis).toBeLessThan(legacy.transferMillis / 4)
      expect(summary.parseMillis).toBeLessThan(20)
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    await runtime.dispose()
  }
}, 30_000)
