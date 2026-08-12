import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readEpisodeProductionConfig } from "./env.js"

describe("Episode Production environment configuration", () => {
  it("parses a dedicated database, NATS servers, and queue group", async () => {
    const config = await Effect.runPromise(
      readEpisodeProductionConfig({
        EPISODE_PRODUCTION_DATABASE_PATH:
          " /var/lib/news-podcast/episode-production.sqlite ",
        NATS_SERVERS: "nats://nats-a:4222, nats://nats-b:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production-a",
      })
    )

    expect(config).toEqual({
      sqlitePath: "/var/lib/news-podcast/episode-production.sqlite",
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      queueGroup: "episode-production-a",
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.natsServers)).toBe(true)
  })

  it("uses only the service-owned database variable", async () => {
    const exit = await Effect.runPromiseExit(
      readEpisodeProductionConfig({
        DATABASE_PATH: "/app/data/shared.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
      })
    )

    expect(exit._tag).toBe("Failure")
  })

  it.each([
    ["memory database", { EPISODE_PRODUCTION_DATABASE_PATH: ":memory:" }],
    ["empty NATS list", { NATS_SERVERS: " , " }],
    ["invalid NATS URL", { NATS_SERVERS: "https://nats.test" }],
    [
      "invalid queue group",
      { EPISODE_PRODUCTION_QUEUE_GROUP: "Episode Production" },
    ],
  ])("rejects %s", async (_case, override) => {
    const exit = await Effect.runPromiseExit(
      readEpisodeProductionConfig({
        EPISODE_PRODUCTION_DATABASE_PATH:
          "/var/lib/news-podcast/episode-production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        ...override,
      })
    )

    expect(exit._tag).toBe("Failure")
  })
})
