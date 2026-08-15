import { Effect, Fiber } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { createHealthState, healthServerScoped } from "./health.js"

const fibers: Array<ReturnType<typeof Effect.runFork>> = []
afterEach(async () => {
  await Promise.all(
    fibers.splice(0).map((fiber) => Effect.runPromise(Fiber.interrupt(fiber)))
  )
})

describe("service health server", () => {
  it("requires every named dependency before becoming ready", () => {
    const state = createHealthState([
      "rpc.sessions",
      "rpc.settings",
      "database",
    ])

    state.ready("rpc.sessions")
    state.ready("database")
    expect(state.isReady()).toBe(false)
    expect(state.snapshot()).toEqual({
      ready: false,
      checks: {
        database: true,
        "rpc.sessions": true,
        "rpc.settings": false,
      },
    })

    state.ready("rpc.settings")
    expect(state.isReady()).toBe(true)
    state.notReady("database")
    expect(state.isReady()).toBe(false)
  })

  it("keeps liveness separate from dependency readiness", async () => {
    const state = createHealthState()
    const port = 45_000 + Math.floor(Math.random() * 1_000)
    const fiber = Effect.runFork(
      Effect.scoped(
        healthServerScoped(port, state).pipe(Effect.andThen(Effect.never))
      )
    )
    fibers.push(fiber)
    await expect
      .poll(() =>
        fetch(`http://127.0.0.1:${port}/health/live`).then(
          (response) => response.status,
          () => 0
        )
      )
      .toBe(200)
    await expect(
      fetch(`http://127.0.0.1:${port}/health/ready`)
    ).resolves.toMatchObject({ status: 503 })
    state.ready()
    await expect(
      fetch(`http://127.0.0.1:${port}/health/ready`)
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      fetch(`http://127.0.0.1:${port}/missing`)
    ).resolves.toMatchObject({ status: 404 })
  })

  it("falls back to the runtime check when no required names are supplied", () => {
    const state = createHealthState([])
    expect(state.snapshot().checks).toEqual({ runtime: false })
    state.ready()
    expect(state.isReady()).toBe(true)
    state.notReady()
    expect(state.isReady()).toBe(false)
  })
})
