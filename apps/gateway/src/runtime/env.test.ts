import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readGatewayConfig } from "./env.js"

describe("Gateway environment configuration", () => {
  it("parses bounded runtime values and comma-separated NATS servers", async () => {
    const config = await Effect.runPromise(
      readGatewayConfig({
        GATEWAY_HOST: "0.0.0.0",
        GATEWAY_PORT: "4100",
        NATS_SERVERS: "nats://nats-a:4222, nats://nats-b:4222",
        NATS_REQUEST_TIMEOUT_MS: "2500",
        DEV_AUTH_ENABLED: "true",
        GOOGLE_CLIENT_ID: "client-id",
      })
    )

    expect(config).toEqual({
      hostname: "0.0.0.0",
      port: 4100,
      natsServers: ["nats://nats-a:4222", "nats://nats-b:4222"],
      requestTimeoutMillis: 2500,
      loginMethods: { development: true, google: true },
      identityHttpOrigin: "http://identity-access:4002",
      authProxyTimeoutMillis: 5000,
      authProxyMaximumResponseBytes: 1048576,
    })
  })

  it.each([
    ["invalid port", { GATEWAY_PORT: "not-a-port" }],
    ["empty server list", { NATS_SERVERS: " , " }],
    ["invalid boolean", { DEV_AUTH_ENABLED: "yes" }],
  ])("rejects %s", async (_name, override) => {
    const failure = await Effect.runPromise(
      readGatewayConfig({
        NATS_SERVERS: "nats://localhost:4222",
        ...override,
      }).pipe(Effect.flip)
    )

    expect(failure).toEqual({
      _tag: "GatewayRuntimeFailed",
      component: "Config",
    })
  })
})
