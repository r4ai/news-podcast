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

  it("exits on a bounded deadline and handles only the first fatal error", async () => {
    const { observability, calls, counts } = recordingObservability()
    let resolveShutdown: (() => void) | undefined
    vi.mocked(observability.shutdown).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve
        })
    )
    const exit = vi.fn()
    let runFallback: (() => void) | undefined
    const cancelFallback = vi.fn()
    const scheduleFallback = vi.fn((callback: () => void, delayMs: number) => {
      runFallback = callback
      expect(delayMs).toBe(5_000)
      return cancelFallback
    })
    const unsubscribe = installProcessErrorListeners(observability, exit, {
      scheduleFallback,
    })

    process.emit("uncaughtException", new TypeError("first"))
    ;(
      process as unknown as { emit(name: string, ...args: unknown[]): boolean }
    ).emit("unhandledRejection", new Error("second"))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toEqual([
      { name: "process.uncaught_exception", level: "error", type: "TypeError" },
    ])
    expect(counts).toEqual(["process.error"])
    expect(observability.shutdown).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    runFallback!()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)

    resolveShutdown!()
    await new Promise((resolve) => setImmediate(resolve))
    expect(cancelFallback).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it("keeps the exit fallback when recording the fatal error itself fails", async () => {
    const { observability } = recordingObservability()
    observability.log = () => {
      throw new Error("logger unavailable")
    }
    const exit = vi.fn()
    let runFallback: (() => void) | undefined
    const scheduleFallback = vi.fn((callback: () => void) => {
      runFallback = callback
      return vi.fn()
    })
    const unsubscribe = installProcessErrorListeners(observability, exit, {
      scheduleFallback,
    })

    expect(() =>
      process.emit("uncaughtException", new Error("boom"))
    ).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))

    expect(scheduleFallback).toHaveBeenCalledOnce()
    expect(observability.shutdown).toHaveBeenCalledOnce()
    runFallback!()
    expect(exit).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
