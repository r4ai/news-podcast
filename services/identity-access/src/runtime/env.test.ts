import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readIdentityAccessConfig } from "./env.js"

const valid = {
  APP_ENV: "development",
  IDENTITY_DATABASE_PATH: "/var/lib/news-podcast/identity.sqlite",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:4173",
  NATS_SERVERS: "nats://nats-a:4222, nats://nats-b:4222",
  IDENTITY_QUEUE_GROUP: "identity-access",
  DEV_AUTH_ENABLED: "true",
  DEV_AUTH_PASSWORD: "hermetic-bearer-token",
  DEV_AUTH_USER_ID: "better-auth-dev_user",
}

describe("Identity Access environment configuration", () => {
  it("parses service-owned storage, Better Auth, NATS, and dev bearer config", async () => {
    const config = await Effect.runPromise(readIdentityAccessConfig(valid))

    expect(config).toEqual({
      httpHost: "0.0.0.0",
      httpPort: 4002,
      databasePath: "/var/lib/news-podcast/identity.sqlite",
      secret: "s".repeat(32),
      baseUrl: "http://localhost:4173",
      appEnvironment: "development",
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      queueGroup: "identity-access",
      devAuth: {
        enabled: true,
        token: "hermetic-bearer-token",
        userId: "better-auth-dev_user",
      },
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.devAuth)).toBe(true)
    expect(Object.isFrozen(config.natsServers)).toBe(true)
  })

  it("never falls back to the legacy shared database", async () => {
    const { IDENTITY_DATABASE_PATH: _, ...withoutIdentityDb } = valid
    const exit = await Effect.runPromiseExit(
      readIdentityAccessConfig({
        ...withoutIdentityDb,
        DATABASE_PATH: "/app/data/shared.sqlite",
      })
    )

    expect(exit._tag).toBe("Failure")
  })

  it.each([
    ["production dev auth", { APP_ENV: "production" }],
    ["short Better Auth secret", { BETTER_AUTH_SECRET: "short" }],
    ["memory database", { IDENTITY_DATABASE_PATH: ":memory:" }],
    ["invalid base URL", { BETTER_AUTH_URL: "file:///tmp/auth" }],
    ["empty NATS", { NATS_SERVERS: " , " }],
    ["invalid queue", { IDENTITY_QUEUE_GROUP: "Identity Access" }],
    ["invalid boolean", { DEV_AUTH_ENABLED: "yes" }],
    ["missing dev token", { DEV_AUTH_PASSWORD: "" }],
    ["whitespace dev user", { DEV_AUTH_USER_ID: "user id" }],
    ["oversized dev user", { DEV_AUTH_USER_ID: "x".repeat(256) }],
    [
      "unpaired Google client ID",
      { DEV_AUTH_ENABLED: "false", GOOGLE_CLIENT_ID: "google-client" },
    ],
  ])("rejects %s", async (_case, override) => {
    const exit = await Effect.runPromiseExit(
      readIdentityAccessConfig({ ...valid, ...override })
    )

    expect(exit._tag).toBe("Failure")
  })

  it("allows dev auth to be disabled in production", async () => {
    const config = await Effect.runPromise(
      readIdentityAccessConfig({
        ...valid,
        APP_ENV: "production",
        DEV_AUTH_ENABLED: "false",
        DEV_AUTH_PASSWORD: "",
        DEV_AUTH_USER_ID: "",
      })
    )

    expect(config.devAuth).toEqual({ enabled: false })
  })
})
