import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { BetterAuthSessionApi } from "../adapters/better-auth-session-reader.js"
import type { UnsafeIdentityAuth } from "../infrastructure/unsafe/better-auth.js"
import { readIdentityAccessConfig } from "./env.js"
import { runIdentityAccessService } from "./service.js"

const config = Effect.runSync(
  readIdentityAccessConfig({
    APP_ENV: "development",
    IDENTITY_DATABASE_PATH: "/var/lib/news-podcast/identity.sqlite",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "http://localhost:4173",
    NATS_SERVERS: "nats://nats:4222",
    IDENTITY_QUEUE_GROUP: "identity-access",
    DEV_AUTH_ENABLED: "false",
  })
)

describe("Identity Access service composition", () => {
  it("releases the NATS runtime before closing the auth database", async () => {
    const events: string[] = []
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const api: BetterAuthSessionApi = {
      getSession: () => Promise.resolve(null),
    }
    const auth: UnsafeIdentityAuth = {
      api,
      close: () => void events.push("auth.closed"),
    }
    const fiber = Effect.runFork(
      runIdentityAccessService(config, {
        createAuth: vi.fn(async () => auth),
        runRpc: (rpcConfig, receivedApi) => {
          expect(rpcConfig).toEqual({
            natsServers: ["nats://nats:4222"],
            queueGroup: "identity-access",
          })
          expect(receivedApi).toBe(api)
          return Effect.acquireRelease(
            Effect.sync(() => {
              events.push("nats.started")
              resolveStarted()
            }),
            () => Effect.sync(() => void events.push("nats.drained"))
          ).pipe(Effect.andThen(Effect.never), Effect.scoped)
        },
      })
    )

    await started
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(events).toEqual(["nats.started", "nats.drained", "auth.closed"])
  })

  it("does not start NATS when Better Auth acquisition fails", async () => {
    const runRpc = vi.fn()
    const exit = await Effect.runPromiseExit(
      runIdentityAccessService(config, {
        createAuth: () => Promise.reject(new Error("migration failed")),
        runRpc,
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(runRpc).not.toHaveBeenCalled()
  })
})
