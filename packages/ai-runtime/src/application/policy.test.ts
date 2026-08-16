import { Effect } from "effect"
import type { AiError } from "effect/unstable/ai"
import { describe, expect, it } from "vitest"

import { applyAiRuntimePolicy } from "./policy.js"

describe("AI runtime execution policy", () => {
  it("fails with Timeout and interrupts the operation", async () => {
    const result = await Effect.runPromise(
      applyAiRuntimePolicy(
        Effect.never as Effect.Effect<never, AiError.AiError>,
        { requestTimeoutMillis: 1 }
      ).pipe(Effect.flip)
    )
    expect(result).toEqual({ _tag: "Timeout" })
  })

  it("lets caller cancellation win", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await Effect.runPromise(
      applyAiRuntimePolicy(
        Effect.never as Effect.Effect<never, AiError.AiError>,
        { requestTimeoutMillis: 10_000, signal: controller.signal }
      ).pipe(Effect.flip)
    )
    expect(result).toEqual({ _tag: "Canceled" })
  })
})
