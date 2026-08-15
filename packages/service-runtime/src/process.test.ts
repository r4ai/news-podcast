import { Cause, Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { startServiceProcess, structuredRuntimeFailure } from "./process.js"

describe("service process supervisor", () => {
  it("drains once and exits zero for repeated termination signals", async () => {
    const listeners = new Map<string, () => void>()
    const events: string[] = []
    const controller = startServiceProcess(Effect.never, {
      service: "example",
      onceSignal: (signal, listener) => void listeners.set(signal, listener),
      shutdownTelemetry: async () => void events.push("telemetry.stopped"),
      exit: (code) => void events.push(`exit:${code}`),
      reportFailure: vi.fn(),
      shutdownTimeoutMs: 50,
    })

    listeners.get("SIGTERM")!()
    listeners.get("SIGTERM")!()
    await controller.completed

    expect(events).toEqual(["telemetry.stopped", "exit:0"])
  })

  it("reports a structured Effect Cause and exits one", async () => {
    const reports: unknown[] = []
    const exits: number[] = []
    const controller = startServiceProcess(
      Effect.fail({ _tag: "DatabaseOpenFailed", password: "do-not-log" }),
      {
        service: "example",
        onceSignal: vi.fn(),
        shutdownTelemetry: async () => undefined,
        exit: (code) => void exits.push(code),
        reportFailure: (failure) => void reports.push(failure),
        shutdownTimeoutMs: 50,
      }
    )

    await controller.completed

    expect(exits).toEqual([1])
    expect(reports).toEqual([
      expect.objectContaining({
        service: "example",
        component: "runtime",
        scope: "process",
        errorType: "DatabaseOpenFailed",
        cause: expect.not.stringContaining("do-not-log"),
      }),
    ])
  })

  it("does not wait forever when telemetry shutdown stalls", async () => {
    const exits: number[] = []
    const controller = startServiceProcess(Effect.fail("fatal"), {
      service: "example",
      onceSignal: vi.fn(),
      shutdownTelemetry: () => new Promise(() => undefined),
      exit: (code) => void exits.push(code),
      reportFailure: vi.fn(),
      shutdownTimeoutMs: 5,
    })

    await controller.completed
    expect(exits).toEqual([1])
  })

  it("handles fatal process events even when telemetry is disabled", async () => {
    const fatal = new Map<string, (failure: unknown) => void>()
    const reports: unknown[] = []
    const exits: number[] = []
    const controller = startServiceProcess(Effect.never, {
      service: "example",
      onceSignal: vi.fn(),
      onceFatal: (event, listener) => void fatal.set(event, listener),
      shutdownTelemetry: async () => undefined,
      exit: (code) => void exits.push(code),
      reportFailure: (failure) => void reports.push(failure),
    })

    fatal.get("unhandledRejection")!(new TypeError("boom"))
    await controller.completed

    expect(exits).toEqual([1])
    expect(reports).toEqual([
      expect.objectContaining({ errorType: "TypeError" }),
    ])
  })

  it("reports unexpected successful completion as fatal", async () => {
    const reports: unknown[] = []
    const controller = startServiceProcess(Effect.void, {
      service: "example",
      onceSignal: vi.fn(),
      shutdownTelemetry: async () => undefined,
      exit: vi.fn(),
      reportFailure: (failure) => void reports.push(failure),
    })
    await controller.completed
    expect(reports).toEqual([
      expect.objectContaining({ errorType: "UnexpectedRuntimeCompletion" }),
    ])
  })

  it("redacts defect messages and preserves interruption kind", () => {
    expect(
      structuredRuntimeFailure(
        "example",
        Cause.die(new Error("token=private-value"))
      )
    ).toMatchObject({
      errorType: "Error",
      cause: expect.not.stringContaining("private-value"),
    })
    expect(
      structuredRuntimeFailure("example", Cause.interrupt()).cause
    ).toContain("Interrupt")
  })

  it("still exits when telemetry shutdown rejects", async () => {
    const reportFailure = vi.fn()
    const exit = vi.fn()
    const controller = startServiceProcess(Effect.fail("fatal"), {
      service: "example",
      onceSignal: vi.fn(),
      shutdownTelemetry: () => Promise.reject(new Error("flush failed")),
      exit,
      reportFailure,
    })
    await controller.completed
    expect(exit).toHaveBeenCalledWith(1)
    expect(reportFailure).toHaveBeenCalledTimes(2)
  })
})
