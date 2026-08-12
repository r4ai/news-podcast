import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readEpisodeLibraryConfig } from "./env.js"

const validEnvironment = {
  EPISODE_LIBRARY_DATABASE_PATH: "/data/library.sqlite",
  NATS_SERVERS: "nats://nats-a:4222,nats://nats-b:4222",
  EPISODE_LIBRARY_QUEUE_GROUP: "episode-library",
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
