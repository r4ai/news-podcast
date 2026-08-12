import { Effect, Layer, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AudioAccessSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  JobReceiptSchema,
  SessionHeadersSchema,
} from "./contract.js"
import { makeGatewayHandlers, makeGatewayHandlerLayer } from "./handlers.js"
import type { GatewayPorts } from "./ports.js"

const health = { status: "ok" as const }
const anonymous = {
  authenticated: false as const,
  loginMethods: { development: false, google: true },
}
const jobReceipt = Schema.decodeUnknownSync(JobReceiptSchema)({
  id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  status: "queued",
  createdAt: "2026-08-12T00:00:00.000Z",
  attempt: 0,
  maxAttempts: 4,
})
const audioAccess = Schema.decodeUnknownSync(AudioAccessSchema)({
  url: "https://audio.example.test/episode.mp3?token=secret",
  expiresAt: "2026-08-12T00:05:00.000Z",
})

const makePorts = (): GatewayPorts => ({
  health: () => Effect.succeed(health),
  resolveSession: () => Effect.succeed(anonymous),
  createEpisodeJob: () => Effect.succeed(jobReceipt),
  listEpisodes: () => Effect.succeed({ items: [], page: { hasMore: false } }),
  createAudioAccess: () => Effect.succeed(audioAccess),
})

describe("gateway port handlers", () => {
  it("injects every external port into a buildable Effect HttpApi layer", async () => {
    const context = await Effect.runPromise(
      Layer.build(makeGatewayHandlerLayer(makePorts())).pipe(Effect.scoped)
    )

    expect(context).toBeDefined()
  })

  it("deep-freezes every successful port result", async () => {
    const handlers = makeGatewayHandlers(makePorts())
    const headers = Schema.decodeUnknownSync(SessionHeadersSchema)({})
    const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
      "3c4d046c-b47b-4047-a562-66ac7e74e995"
    )
    const results = await Effect.runPromise(
      Effect.all([
        handlers.health(),
        handlers.resolveSession(headers),
        handlers.listEpisodes(headers),
        handlers.createAudioAccess({ headers, episodeId }),
      ])
    )

    for (const result of results) {
      expect(Object.isFrozen(result)).toBe(true)
    }
    expect(Object.isFrozen(results[1]?.loginMethods)).toBe(true)
    expect(Object.isFrozen(results[2]?.items)).toBe(true)
  })

  it("deep-freezes data before and after the external port", async () => {
    const createEpisodeJob = vi.fn((input) => {
      expect(Object.isFrozen(input)).toBe(true)
      expect(Object.isFrozen(input.headers)).toBe(true)
      expect(Object.isFrozen(input.payload)).toBe(true)
      expect(Object.isFrozen(input.payload.articleIds)).toBe(true)
      return makePorts().createEpisodeJob(input)
    })
    const handlers = makeGatewayHandlers({
      ...makePorts(),
      createEpisodeJob,
    })

    const receipt = await Effect.runPromise(
      handlers.createEpisodeJob({
        headers: Schema.decodeUnknownSync(CreateEpisodeJobHeadersSchema)({
          "idempotency-key": "request-1",
        }),
        payload: Schema.decodeUnknownSync(CreateEpisodeJobRequestSchema)({
          trigger: "manual",
          articleIds: ["5af55f2e-ff0b-475c-866a-f2cff48c101d"],
        }),
      })
    )

    expect(createEpisodeJob).toHaveBeenCalledOnce()
    expect(Object.isFrozen(handlers)).toBe(true)
    expect(Object.isFrozen(receipt)).toBe(true)
  })
})
