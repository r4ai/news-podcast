import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readContentKnowledgeConfig } from "./env.js"
import { parseNodeServiceConfig } from "./node.js"

const validEnvironment = {
  APP_ENV: "development",
  CONTENT_KNOWLEDGE_DATABASE_PATH: "/data/content.sqlite",
  NATS_SERVERS: "nats://nats-a:4222, nats://nats-b:4222",
  CONTENT_RPC_QUEUE_GROUP: "content-rpc",
  CONTENT_RSS_TIMEOUT_MS: "15000",
  CONTENT_RSS_MAX_BYTES: "5242880",
  CONTENT_RSS_INTERVAL_MS: "60000",
  CONTENT_RSS_INITIAL_BACKOFF_MS: "1000",
  CONTENT_RSS_MAX_BACKOFF_MS: "30000",
  CONTENT_ENRICH_DAILY_LIMIT: "200",
  CONTENT_ENRICH_INTERVAL_MS: "60000",
  CONTENT_ENRICH_INITIAL_BACKOFF_MS: "1000",
  CONTENT_ENRICH_MAX_BACKOFF_MS: "30000",
  CONTENT_ARCHIVE_TIMEOUT_MS: "20000",
  CONTENT_ARCHIVE_MAX_HTML_BYTES: "2097152",
  S3_ENDPOINT: "http://seaweedfs:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "news-podcast",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
}

describe("content-knowledge environment boundary", () => {
  it.each([undefined, "fake", "typo", "Live"] as const)(
    "rejects production provider mode %s",
    async (providerMode) => {
      const exit = await Effect.runPromiseExit(
        readContentKnowledgeConfig({
          ...validEnvironment,
          APP_ENV: "production",
          PROVIDER_MODE: providerMode,
          OPENAI_API_KEY: "test-key",
          CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
        })
      )

      expect(exit._tag).toBe("Failure")
    }
  )

  it.each([
    ["missing API key", { OPENAI_API_KEY: undefined }],
    ["missing model", { CONTENT_ENRICH_OPENAI_MODEL: undefined }],
  ])("rejects production live mode with %s", async (_name, override) => {
    const exit = await Effect.runPromiseExit(
      readContentKnowledgeConfig({
        ...validEnvironment,
        APP_ENV: "production",
        PROVIDER_MODE: "live",
        OPENAI_API_KEY: "test-key",
        CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
        ...override,
      })
    )

    expect(exit._tag).toBe("Failure")
  })

  it("accepts production only with exact live mode and credentials", async () => {
    const config = await Effect.runPromise(
      readContentKnowledgeConfig({
        ...validEnvironment,
        APP_ENV: "production",
        PROVIDER_MODE: "live",
        OPENAI_API_KEY: "test-key",
        CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
      })
    )

    expect(config.appEnvironment).toBe("production")
    expect(config.enrichment.provider).toMatchObject({ model: "gpt-test" })
  })

  it("rejects a direct production service config that bypasses the env reader with fake mode", async () => {
    const fake = await Effect.runPromise(
      readContentKnowledgeConfig(validEnvironment)
    )

    const exit = await Effect.runPromiseExit(
      parseNodeServiceConfig({
        ...fake,
        appEnvironment: "production",
      })
    )

    expect(exit._tag).toBe("Failure")
  })

  it("projects, parses, and freezes only service-owned configuration", async () => {
    const config = await Effect.runPromise(
      readContentKnowledgeConfig({ ...validEnvironment, UNRELATED: "ignored" })
    )

    expect(config).toEqual({
      appEnvironment: "development",
      sqlitePath: "/data/content.sqlite",
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      rpc: { queueGroup: "content-rpc" },
      feedPoller: {
        http: { timeoutMillis: 15_000, maximumBytes: 5_242_880 },
        loop: {
          intervalMillis: 60_000,
          initialBackoffMillis: 1_000,
          maximumBackoffMillis: 30_000,
        },
      },
      enrichment: {
        dailyLimit: 200,
        resetDailyEnabled: false,
        provider: null,
        loop: {
          intervalMillis: 60_000,
          initialBackoffMillis: 1_000,
          maximumBackoffMillis: 30_000,
        },
      },
      searchIndex: {
        batchSize: 10,
        loop: {
          intervalMillis: 5_000,
          initialBackoffMillis: 1_000,
          maximumBackoffMillis: 30_000,
        },
      },
      archive: {
        endpoint: "http://seaweedfs:8333",
        region: "us-east-1",
        bucket: "news-podcast",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        timeoutMillis: 20_000,
        maximumHtmlBytes: 2_097_152,
        maximumAssetBytes: 20_971_520,
        maximumAssetCount: 512,
        maximumAssetTotalBytes: 104_857_600,
        cleanup: {
          intervalMillis: 21_600_000,
          retentionMillis: 86_400_000,
        },
      },
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.rpc)).toBe(true)
  })

  it.each([
    [
      "production enrichment reset",
      {
        ...validEnvironment,
        APP_ENV: "production",
        CONTENT_ENRICH_RESET_ENABLED: "true",
      },
    ],
    [
      "invalid enrichment reset flag",
      { ...validEnvironment, CONTENT_ENRICH_RESET_ENABLED: "yes" },
    ],
    [
      "shared database path",
      {
        ...validEnvironment,
        CONTENT_KNOWLEDGE_DATABASE_PATH: undefined,
        DATABASE_PATH: "/shared.sqlite",
      },
    ],
    [
      "memory database",
      { ...validEnvironment, CONTENT_KNOWLEDGE_DATABASE_PATH: ":memory:" },
    ],
    [
      "invalid NATS URL",
      { ...validEnvironment, NATS_SERVERS: "https://nats.test" },
    ],
    [
      "enrichment backoff inversion",
      { ...validEnvironment, CONTENT_ENRICH_INITIAL_BACKOFF_MS: "40000" },
    ],
    [
      "out-of-range enrichment budget",
      { ...validEnvironment, CONTENT_ENRICH_DAILY_LIMIT: "10001" },
    ],
    [
      "orphan retention shorter than an in-flight capture",
      {
        ...validEnvironment,
        CONTENT_ARCHIVE_ORPHAN_RETENTION_MS: "10000",
      },
    ],
    [
      "partial OpenAI configuration",
      {
        ...validEnvironment,
        PROVIDER_MODE: "live",
        OPENAI_API_KEY: "test-key",
      },
    ],
  ])("rejects %s", async (_name, environment) => {
    const exit = await Effect.runPromiseExit(
      readContentKnowledgeConfig(environment)
    )

    expect(exit._tag).toBe("Failure")
  })

  it.each([
    ["production", undefined, false],
    ["development", undefined, false],
    ["development", "false", false],
    ["development", "true", true],
    ["test", "true", true],
  ] as const)(
    "projects reset policy for APP_ENV=%s and flag=%s",
    async (appEnvironment, flag, expected) => {
      const config = await Effect.runPromise(
        readContentKnowledgeConfig({
          ...validEnvironment,
          APP_ENV: appEnvironment,
          CONTENT_ENRICH_RESET_ENABLED: flag,
          ...(appEnvironment === "production"
            ? {
                PROVIDER_MODE: "live",
                OPENAI_API_KEY: "test-key",
                CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
              }
            : {}),
        })
      )

      expect(config.appEnvironment).toBe(appEnvironment)
      expect(config.enrichment.resetDailyEnabled).toBe(expected)
    }
  )

  it("enables the OpenAI provider only when key and model are both configured", async () => {
    const config = await Effect.runPromise(
      readContentKnowledgeConfig({
        ...validEnvironment,
        PROVIDER_MODE: "live",
        OPENAI_API_KEY: "test-key",
        CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
      })
    )

    expect(config.enrichment.provider).toEqual({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      requestTimeoutMillis: 60_000,
    })
  })

  it("keeps enrichment offline in fake provider mode even when a key remains", async () => {
    const config = await Effect.runPromise(
      readContentKnowledgeConfig({
        ...validEnvironment,
        PROVIDER_MODE: "fake",
        OPENAI_API_KEY: "test-key",
        CONTENT_ENRICH_OPENAI_MODEL: "gpt-test",
      })
    )

    expect(config.enrichment.provider).toBeNull()
  })
})
