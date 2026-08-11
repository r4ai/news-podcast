import { describe, expect, it, vi } from "vitest"

import { installProcessErrorListeners } from "./node-process.js"
import type { Observability } from "./contract.js"

function recordingObservability() {
  const calls: Array<{ name: string; level: string; type?: string }> = []
  const counts: string[] = []
  const observability: Observability = {
    log: (event) =>
      calls.push({
        name: event.name,
        level: event.level ?? "info",
        ...(event.error instanceof Error ? { type: event.error.name } : {}),
      }),
    withSpan: (_name, _attributes, operation) => operation(),
    withGuaranteedSpan: (_name, operation) => operation(),
    assertActiveSpan: () => undefined,
    count: (name) => counts.push(name),
    measure: () => undefined,
    gauge: () => undefined,
    captureContext: () => undefined,
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
  return { observability, calls, counts }
}

describe("process error listeners", () => {
  it("records uncaught exceptions and exits after flushing telemetry", async () => {
    const { observability, calls, counts } = recordingObservability()
    const exit = vi.fn()
    const unsubscribe = installProcessErrorListeners(observability, exit)

    process.emit("uncaughtException", new TypeError("boom"))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toEqual([
      { name: "process.uncaught_exception", level: "error", type: "TypeError" },
    ])
    expect(counts).toEqual(["process.error"])
    expect(observability.shutdown).toHaveBeenCalledOnce()
    await new Promise((resolve) => setImmediate(resolve))
    expect(exit).toHaveBeenCalledWith(1)
    unsubscribe()
  })

  it("records unhandled rejections with a normalized error", async () => {
    const { observability, calls, counts } = recordingObservability()
    const exit = vi.fn()
    const unsubscribe = installProcessErrorListeners(observability, exit)

    ;(
      process as unknown as { emit(name: string, ...args: unknown[]): boolean }
    ).emit("unhandledRejection", "plain value")
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toEqual([
      { name: "process.unhandled_rejection", level: "error", type: "Error" },
    ])
    expect(counts).toEqual(["process.error"])
    await new Promise((resolve) => setImmediate(resolve))
    expect(exit).toHaveBeenCalledWith(1)
    unsubscribe()
  })
})
