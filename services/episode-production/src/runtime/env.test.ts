import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  readEpisodeProductionConfig,
  readEpisodeProductionServiceConfig,
} from "./env.js"

describe("Episode Production environment configuration", () => {
  it("parses every provider and worker boundary for the executable service", async () => {
    const config = await Effect.runPromise(
      readEpisodeProductionServiceConfig({
        EPISODE_PRODUCTION_DATABASE_PATH: "/data/production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-test",
        VOICEVOX_BASE_URL: "http://voicevox:50021",
        VOICEVOX_CHARACTER_NAME: "ずんだもん",
        S3_ENDPOINT: "http://seaweedfs:8333",
        S3_REGION: "us-east-1",
        S3_BUCKET: "news-podcast",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
        EPISODE_WORKER_HEARTBEAT_MS: "60000",
      })
    )

    expect(config.rpc.sqlitePath).toBe("/data/production.sqlite")
    expect(config.providerMode).toBe("fake")
    expect(config.openAi).toMatchObject({ model: "gpt-test" })
    expect(config.voicevox.baseUrl).toBe("http://voicevox:50021")
    expect(config.voicevox.maximumTextCharactersPerRequest).toBe(200)
    expect(config.completionRelay.batchSize).toBe(50)
    expect(config.worker.heartbeatMillis).toBe(60_000)
    expect(config.worker.cancellationPollMillis).toBe(250)
    expect(Object.isFrozen(config.s3)).toBe(true)
  })

  it("rejects an executable service without provider credentials", async () => {
    const exit = await Effect.runPromiseExit(
      readEpisodeProductionServiceConfig({
        EPISODE_PRODUCTION_DATABASE_PATH: "/data/production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        PROVIDER_MODE: "live",
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  it("accepts fake mode without an OpenAI credential", async () => {
    const config = await Effect.runPromise(
      readEpisodeProductionServiceConfig({
        EPISODE_PRODUCTION_DATABASE_PATH: "/data/production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        PROVIDER_MODE: "fake",
        VOICEVOX_BASE_URL: "http://voicevox:50021",
        VOICEVOX_CHARACTER_NAME: "ずんだもん",
        S3_ENDPOINT: "http://seaweedfs:8333",
        S3_REGION: "us-east-1",
        S3_BUCKET: "news-podcast",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
      })
    )

    expect(config.providerMode).toBe("fake")
    expect(config.openAi.apiKey).toBe("")
  })

  it("rejects a heartbeat interval above one third of the lease", async () => {
    const exit = await Effect.runPromiseExit(
      readEpisodeProductionServiceConfig({
        EPISODE_PRODUCTION_DATABASE_PATH: "/data/production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-test",
        VOICEVOX_BASE_URL: "http://voicevox:50021",
        VOICEVOX_CHARACTER_NAME: "ずんだもん",
        S3_ENDPOINT: "http://seaweedfs:8333",
        S3_REGION: "us-east-1",
        S3_BUCKET: "news-podcast",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
        EPISODE_WORKER_LEASE_MS: "300000",
        EPISODE_WORKER_HEARTBEAT_MS: "100001",
      })
    )

    expect(exit._tag).toBe("Failure")
  })

  it("rejects cancellation polling above the provider-abort SLA", async () => {
    const exit = await Effect.runPromiseExit(
      readEpisodeProductionServiceConfig({
        EPISODE_PRODUCTION_DATABASE_PATH: "/data/production.sqlite",
        NATS_SERVERS: "nats://nats:4222",
        EPISODE_PRODUCTION_QUEUE_GROUP: "episode-production",
        PROVIDER_MODE: "fake",
        VOICEVOX_BASE_URL: "http://voicevox:50021",
        VOICEVOX_CHARACTER_NAME: "test",
        S3_ENDPOINT: "http://seaweedfs:8333",
        S3_REGION: "us-east-1",
        S3_BUCKET: "news-podcast",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
        EPISODE_WORKER_CANCELLATION_POLL_MS: "5001",
      })
    )

    expect(exit._tag).toBe("Failure")
  })

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
