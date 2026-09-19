import { Effect, Metric } from "effect"
import { expect, it } from "vitest"

import {
  episodeListLatencyMillis,
  episodeListPayloadBytes,
  observeEpisodeList,
} from "./episode-list-metrics.js"

it("records UTF-8 success bytes and latency for success and failure without user labels", async () => {
  const page = { items: [{ title: "ニュース" }], page: { hasMore: false } }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const success = yield* observeEpisodeList(Effect.succeed(page))
      yield* observeEpisodeList(Effect.fail("unavailable")).pipe(Effect.ignore)
      return {
        success,
        bytes: yield* Metric.value(episodeListPayloadBytes),
        latency: yield* Metric.value(episodeListLatencyMillis),
      }
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
  )
  expect(result.success).toEqual(page)
  expect(result.bytes.count).toBe(1)
  expect(result.bytes.sum).toBe(
    new TextEncoder().encode(JSON.stringify(page)).byteLength
  )
  expect(result.latency.count).toBe(2)
})
