import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { startContentKnowledgeProcess } from "./process.js"

describe("content-knowledge process lifecycle", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "interrupts on %s, releases runtime, flushes telemetry, and exits once",
    async (signal) => {
      const events: string[] = []
      const listeners = new Map<string, () => void>()
      const controller = startContentKnowledgeProcess(
        Effect.scoped(
          Effect.acquireRelease(
            Effect.sync(() => void events.push("runtime.started")),
            () => Effect.sync(() => void events.push("runtime.released"))
          ).pipe(Effect.andThen(Effect.never))
        ),
        {
          onceSignal: (name, listener) => void listeners.set(name, listener),
          shutdownTelemetry: async () => void events.push("telemetry.stopped"),
          exit: (code) => void events.push(`exit:${code}`),
          reportFailure: vi.fn(),
        }
      )

      await vi.waitFor(() => expect(events).toContain("runtime.started"))
      listeners.get(signal)!()
      listeners.get(signal)!()
      await controller.completed

      expect(events).toEqual([
        "runtime.started",
        "runtime.released",
        "telemetry.stopped",
        "exit:0",
      ])
    }
  )

  it("flushes telemetry and exits non-zero when startup fails", async () => {
    const events: string[] = []
    const reportFailure = vi.fn()
    const controller = startContentKnowledgeProcess(
      Effect.fail({ _tag: "RuntimeFailed" }),
      {
        onceSignal: vi.fn(),
        shutdownTelemetry: async () => void events.push("telemetry.stopped"),
        exit: (code) => void events.push(`exit:${code}`),
        reportFailure,
      }
    )

    await controller.completed

    expect(reportFailure).toHaveBeenCalledOnce()
    expect(events).toEqual(["telemetry.stopped", "exit:1"])
  })
})
