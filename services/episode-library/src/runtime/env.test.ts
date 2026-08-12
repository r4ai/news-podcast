import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readEpisodeLibraryConfig } from "./env.js"

const validEnvironment = {
  EPISODE_LIBRARY_DATABASE_PATH: "/data/library.sqlite",
  NATS_SERVERS: "nats://nats-a:4222,nats://nats-b:4222",
  EPISODE_LIBRARY_QUEUE_GROUP: "episode-library",
  EPISODE_LIBRARY_COMPLETION_STREAM: "EPISODE_PRODUCTION",
  EPISODE_LIBRARY_COMPLETION_DURABLE_NAME: "episode-library-completions",
  EPISODE_LIBRARY_COMPLETION_ACK_WAIT_MILLIS: "30000",
  EPISODE_LIBRARY_COMPLETION_MAXIMUM_DELIVERIES: "10",
  EPISODE_LIBRARY_COMPLETION_INITIAL_NACK_DELAY_MILLIS: "1000",
  EPISODE_LIBRARY_COMPLETION_MAXIMUM_NACK_DELAY_MILLIS: "30000",
  S3_ENDPOINT: "http://seaweedfs:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "private-audio",
  S3_ACCESS_KEY_ID: "access-id",
  S3_SECRET_ACCESS_KEY: "secret-key",
}

describe("episode-library environment boundary", () => {
  it("strictly parses and freezes owned database, NATS, and S3 config", async () => {
    const config = await Effect.runPromise(
      readEpisodeLibraryConfig({ ...validEnvironment, UNRELATED: "ignored" })
    )

    expect(config).toEqual({
      sqlitePath: "/data/library.sqlite",
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      queueGroup: "episode-library",
      completionConsumer: {
        stream: "EPISODE_PRODUCTION",
        durableName: "episode-library-completions",
        ackWaitMillis: 30_000,
        maximumDeliveries: 10,
        initialNackDelayMillis: 1_000,
        maximumNackDelayMillis: 30_000,
      },
      s3: {
        endpoint: "http://seaweedfs:8333",
        region: "us-east-1",
        bucket: "private-audio",
        accessKeyId: "access-id",
        secretAccessKey: "secret-key",
      },
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.s3)).toBe(true)
  })

  it.each([
    [
      "shared database path",
      {
        EPISODE_LIBRARY_DATABASE_PATH: undefined,
        DATABASE_PATH: "/shared.sqlite",
      },
    ],
    ["memory database", { EPISODE_LIBRARY_DATABASE_PATH: ":memory:" }],
    ["invalid NATS", { NATS_SERVERS: "https://nats.test" }],
    ["missing completion stream", { EPISODE_LIBRARY_COMPLETION_STREAM: "" }],
    [
      "invalid durable name",
      { EPISODE_LIBRARY_COMPLETION_DURABLE_NAME: "Episode Library" },
    ],
    [
      "inverted nack backoff",
      {
        EPISODE_LIBRARY_COMPLETION_INITIAL_NACK_DELAY_MILLIS: "30001",
        EPISODE_LIBRARY_COMPLETION_MAXIMUM_NACK_DELAY_MILLIS: "30000",
      },
    ],
    ["missing region", { S3_REGION: "" }],
    ["endpoint credentials", { S3_ENDPOINT: "https://user:pass@s3.test" }],
    ["invalid bucket", { S3_BUCKET: "Private_Audio" }],
    ["missing access key", { S3_ACCESS_KEY_ID: "" }],
    ["missing secret key", { S3_SECRET_ACCESS_KEY: "" }],
  ])("rejects %s without exposing configuration", async (_case, override) => {
    const failure = await Effect.runPromise(
      readEpisodeLibraryConfig({ ...validEnvironment, ...override }).pipe(
        Effect.flip
      )
    )

    expect(failure).toEqual({
      _tag: "NodeEpisodeLibraryRpcFailed",
      component: "Config",
    })
    expect(JSON.stringify(failure)).not.toContain("secret-key")
  })
})
