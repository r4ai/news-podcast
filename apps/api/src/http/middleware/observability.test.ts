import { describe, expect, it } from "vitest"
import {
  noopObservability,
  type Observability,
} from "@news-podcast/observability"

import { createApp } from "../../app.js"

describe("observabilityMiddleware", () => {
  it("logs api.request with the HTTP route and counts server errors", async () => {
    const logs: Array<{ name: string; level: string; attributes?: unknown }> =
      []
    const counts: string[] = []
    const observability: Observability = {
      ...noopObservability,
      log: (event) =>
        logs.push({
          name: event.name,
          level: event.level ?? "info",
          attributes: event.attributes,
        }),
      count: (name) => counts.push(name),
    }
    const response = await createApp({
      observability,
      resolveOwner: async () => "owner-1",
    }).request("/v1/feeds")

    expect(response.status).toBe(503)
    const requestLog = logs.find((event) => event.name === "api.request")
    expect(requestLog).toMatchObject({
      level: "error",
      attributes: {
        "http.request.method": "GET",
        "http.response.status_code": 503,
        "http.route": "/v1/feeds",
      },
    })
    expect(counts).toContain("http.server.error")
  })
})
