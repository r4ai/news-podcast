import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readContentKnowledgeConfig } from "./env.js"

const validEnvironment = {
  CONTENT_KNOWLEDGE_DATABASE_PATH: "/data/content.sqlite",
  NATS_SERVERS: "nats://nats-a:4222, nats://nats-b:4222",
  CONTENT_OUTBOX_BATCH_SIZE: "50",
  CONTENT_OUTBOX_INTERVAL_MS: "1000",
  CONTENT_OUTBOX_INITIAL_BACKOFF_MS: "200",
  CONTENT_OUTBOX_MAX_BACKOFF_MS: "30000",
  CONTENT_RPC_QUEUE_GROUP: "content-rpc",
  CONTENT_RSS_TIMEOUT_MS: "15000",
  CONTENT_RSS_MAX_BYTES: "5242880",
  CONTENT_RSS_INTERVAL_MS: "60000",
  CONTENT_RSS_INITIAL_BACKOFF_MS: "1000",
  CONTENT_RSS_MAX_BACKOFF_MS: "30000",
  CONTENT_ARCHIVE_TIMEOUT_MS: "20000",
  CONTENT_ARCHIVE_MAX_HTML_BYTES: "2097152",
  S3_ENDPOINT: "http://seaweedfs:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "news-podcast",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
}

describe("content-knowledge environment boundary", () => {
  it("projects, parses, and freezes only service-owned configuration", async () => {
    const config = await Effect.runPromise(
      readContentKnowledgeConfig({ ...validEnvironment, UNRELATED: "ignored" })
    )

    expect(config).toEqual({
      sqlitePath: "/data/content.sqlite",
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      relay: {
        batchSize: 50,
        intervalMillis: 1_000,
        initialBackoffMillis: 200,
        maximumBackoffMillis: 30_000,
      },
      rpc: { queueGroup: "content-rpc" },
      feedPoller: {
        http: { timeoutMillis: 15_000, maximumBytes: 5_242_880 },
        loop: {
          intervalMillis: 60_000,
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
      },
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.relay)).toBe(true)
  })

  it.each([
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
      "invalid integer",
      { ...validEnvironment, CONTENT_OUTBOX_BATCH_SIZE: "10x" },
    ],
    [
      "out-of-range batch",
      { ...validEnvironment, CONTENT_OUTBOX_BATCH_SIZE: "101" },
    ],
    [
      "invalid NATS URL",
      { ...validEnvironment, NATS_SERVERS: "https://nats.test" },
    ],
    [
      "backoff inversion",
      { ...validEnvironment, CONTENT_OUTBOX_INITIAL_BACKOFF_MS: "40000" },
    ],
  ])("rejects %s", async (_name, environment) => {
    const exit = await Effect.runPromiseExit(
      readContentKnowledgeConfig(environment)
    )

    expect(exit._tag).toBe("Failure")
  })
})
