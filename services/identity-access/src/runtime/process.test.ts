import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { startIdentityAccessProcess } from "./process.js"
import { readIdentityAccessConfig } from "./env.js"
import { runIdentityAccessService } from "./service.js"

describe("Identity Access process lifecycle", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "interrupts on %s, waits for release, flushes telemetry, and exits once",
    async (signal) => {
      const events: string[] = []
      const listeners = new Map<string, () => void>()
      const controller = startIdentityAccessProcess(
        Effect.scoped(
          Effect.acquireRelease(
            Effect.sync(() => void events.push("service.started")),
            () => Effect.sync(() => void events.push("service.released"))
          ).pipe(Effect.andThen(Effect.never))
        ),
        {
          onceSignal: (name, listener) => void listeners.set(name, listener),
          shutdownTelemetry: async () => void events.push("telemetry.stopped"),
          exit: (code) => void events.push(`exit:${code}`),
          reportFailure: vi.fn(),
        }
      )

      await vi.waitFor(() => expect(events).toContain("service.started"))
      listeners.get(signal)!()
      listeners.get(signal)!()
      await controller.completed

      expect(events).toEqual([
        "service.started",
        "service.released",
        "telemetry.stopped",
        "exit:0",
      ])
    }
  )

  it("reports an unexpected runtime exit and exits non-zero", async () => {
    const events: string[] = []
    const reportFailure = vi.fn()
    const controller = startIdentityAccessProcess(Effect.void, {
      onceSignal: vi.fn(),
      shutdownTelemetry: async () => void events.push("telemetry.stopped"),
      exit: (code) => void events.push(`exit:${code}`),
      reportFailure,
    })

    await controller.completed

    expect(reportFailure).toHaveBeenCalledOnce()
    expect(events).toEqual(["telemetry.stopped", "exit:1"])
  })

  it("orders signal shutdown as NATS drain, auth close, telemetry flush", async () => {
    const events: string[] = []
    const listeners = new Map<string, () => void>()
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const config = Effect.runSync(
      readIdentityAccessConfig({
        APP_ENV: "development",
        IDENTITY_DATABASE_PATH: "/var/lib/news-podcast/identity.sqlite",
        BETTER_AUTH_SECRET: "s".repeat(32),
        BETTER_AUTH_URL: "http://localhost:4173",
        NATS_SERVERS: "nats://nats:4222",
        IDENTITY_QUEUE_GROUP: "identity-access",
      })
    )
    const service = runIdentityAccessService(config, {
      startRuntime: () =>
        Effect.succeed({
          api: { getSession: () => Promise.resolve(null) },
          settings: {} as never,
          close: () => Effect.sync(() => void events.push("auth.closed")),
        }),
      runRpc: () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            events.push("nats.started")
            resolveStarted()
          }),
          () => Effect.sync(() => void events.push("nats.drained"))
        ).pipe(Effect.andThen(Effect.never), Effect.scoped),
    })
    const controller = startIdentityAccessProcess(service, {
      onceSignal: (name, listener) => void listeners.set(name, listener),
      shutdownTelemetry: async () => void events.push("telemetry.stopped"),
      exit: (code) => void events.push(`exit:${code}`),
      reportFailure: vi.fn(),
    })

    await started
    listeners.get("SIGTERM")!()
    await controller.completed

    expect(events).toEqual([
      "nats.started",
      "nats.drained",
      "auth.closed",
      "telemetry.stopped",
      "exit:0",
    ])
  })
})
