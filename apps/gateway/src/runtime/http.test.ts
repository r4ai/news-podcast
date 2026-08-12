import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { GatewayPorts } from "../ports.js"
import { makeGatewayWebHandler } from "./http.js"

const unavailable = {
  type: "about:blank",
  title: "Unavailable",
  status: 503 as const,
  code: "unavailable",
}

const ports: GatewayPorts = {
  health: () => Effect.succeed({ status: "ok" }),
  resolveSession: () =>
    Effect.succeed({
      authenticated: false,
      loginMethods: { development: true, google: false },
    }),
  createEpisodeJob: () => Effect.fail(unavailable),
  listEpisodes: () => Effect.fail(unavailable),
  createAudioAccess: () => Effect.fail(unavailable),
}

describe("Gateway HTTP runtime", () => {
  it("serves the Effect HttpApi contract through a Fetch handler", async () => {
    const runtime = makeGatewayWebHandler(ports)

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/health")
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok" })
    } finally {
      await runtime.dispose()
    }
  })

  it("rejects malformed requests before invoking a port", async () => {
    let calls = 0
    const runtime = makeGatewayWebHandler({
      ...ports,
      createEpisodeJob: () => {
        calls += 1
        return Effect.fail(unavailable)
      },
    })

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/v1/episode-jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trigger: "manual" }),
        })
      )

      expect(response.status).toBe(400)
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })
})
