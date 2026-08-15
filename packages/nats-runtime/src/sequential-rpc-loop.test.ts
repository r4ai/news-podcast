import { Cause, Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  logRpcDeliveryFailure,
  runSequentialRpcLoop,
} from "./sequential-rpc-loop.js"

describe("sequential RPC delivery isolation", () => {
  it("continues after invalid input, reply loss, and unexpected handler failure", async () => {
    const pending = [
      "normal-1",
      "invalid",
      "reply-lost",
      "handler-failed",
      "normal-2",
    ]
    const handled: string[] = []
    const failures: string[] = []

    const failure = await Effect.runPromise(
      Effect.flip(
        runSequentialRpcLoop({
          receive: Effect.sync(() => pending.shift()),
          sourceClosed: () => ({ _tag: "SubscriptionClosed" as const }),
          handle: (value) => {
            handled.push(value)
            return value === "normal-1" || value === "normal-2"
              ? Effect.void
              : Effect.fail({ _tag: value })
          },
          onDeliveryFailure: (cause) =>
            Effect.sync(() => void failures.push(cause.reasons[0]!._tag)),
        })
      )
    )

    expect(failure).toEqual({ _tag: "SubscriptionClosed" })
    expect(handled).toEqual([
      "normal-1",
      "invalid",
      "reply-lost",
      "handler-failed",
      "normal-2",
    ])
    expect(failures).toHaveLength(3)
  })

  it("keeps receive failure terminal", async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        runSequentialRpcLoop({
          receive: Effect.fail({ _tag: "ReceiveFailed" as const }),
          sourceClosed: () => ({ _tag: "SubscriptionClosed" as const }),
          handle: () => Effect.void,
          onDeliveryFailure: () => Effect.void,
        })
      )
    )

    expect(result).toEqual({ _tag: "ReceiveFailed" })
  })

  it("never overlaps delivery handlers", async () => {
    const pending = [1, 2, 3]
    let active = 0
    let maximumActive = 0

    await Effect.runPromise(
      Effect.flip(
        runSequentialRpcLoop({
          receive: Effect.sync(() => pending.shift()),
          sourceClosed: () => ({ _tag: "SubscriptionClosed" as const }),
          handle: () =>
            Effect.tryPromise(async () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              await Promise.resolve()
              active -= 1
            }),
          onDeliveryFailure: () => Effect.void,
        })
      )
    )

    expect(maximumActive).toBe(1)
  })

  it("redacts delivery causes to error type metadata", async () => {
    await Effect.runPromise(
      Effect.all([
        logRpcDeliveryFailure(
          "service",
          "scope",
          Cause.fail({ _tag: "Typed" })
        ),
        logRpcDeliveryFailure("service", "scope", Cause.fail("plain")),
        logRpcDeliveryFailure(
          "service",
          "scope",
          Cause.die(new TypeError("secret"))
        ),
        logRpcDeliveryFailure("service", "scope", Cause.die("defect")),
        logRpcDeliveryFailure("service", "scope", Cause.interrupt()),
      ])
    )
  })
})
