import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { EpisodeJob } from "../domain/episode-job.js"
import { runScheduledGenerationTick } from "./scheduled-generation.js"

const schedule = { ownerId: "owner-1", localDate: "2026-08-13" }
const job = (
  state:
    | "Queued"
    | "Running"
    | "Retrying"
    | "Succeeded"
    | "Failed"
    | "Canceled",
  failureCode = "script_refusal"
): EpisodeJob =>
  ({
    _tag: state,
    request: { trigger: "scheduled" },
    ...(state === "Failed"
      ? { failure: { code: failureCode, retryable: false } }
      : {}),
  }) as EpisodeJob

const run = async (created: Effect.Effect<EpisodeJob, string>) => {
  const complete = vi.fn(() => Effect.void)
  const observe = vi.fn(() => Effect.void)
  const result = await Effect.runPromise(
    runScheduledGenerationTick({
      discoverDue: () => Effect.succeed([schedule]),
      create: () => created,
      complete,
      observe,
    })
  )
  return { complete, observe, result }
}

describe("scheduled generation tick", () => {
  it("keeps an accepted or running job due until the episode succeeds", async () => {
    for (const state of ["Queued", "Running", "Retrying"] as const) {
      const { complete, observe, result } = await run(
        Effect.succeed(job(state))
      )

      expect(complete).not.toHaveBeenCalled()
      expect(observe).toHaveBeenCalledWith({ _tag: "Retrying", ...schedule })
      expect(result).toEqual({
        discovered: 1,
        succeeded: 0,
        retrying: 1,
        missed: 0,
        failed: 0,
      })
    }
  })

  it("completes the daily intent only after the episode succeeds", async () => {
    const { complete, observe, result } = await run(
      Effect.succeed(job("Succeeded"))
    )

    expect(complete).toHaveBeenCalledWith("owner-1", "2026-08-13")
    expect(observe).toHaveBeenCalledWith({ _tag: "Succeeded", ...schedule })
    expect(result.succeeded).toBe(1)
  })

  it("keeps a service-shutdown cancellation due for recovery", async () => {
    const { complete, observe, result } = await run(
      Effect.succeed({
        ...job("Canceled"),
        reason: "service_shutdown",
      } as EpisodeJob)
    )

    expect(complete).not.toHaveBeenCalled()
    expect(observe).toHaveBeenCalledWith({ _tag: "Retrying", ...schedule })
    expect(result.retrying).toBe(1)
  })

  it.each([job("Canceled"), job("Failed")])(
    "closes canceled and terminally failed intents as missed",
    async (terminal) => {
      const { complete, observe, result } = await run(Effect.succeed(terminal))

      expect(complete).toHaveBeenCalledWith("owner-1", "2026-08-13")
      expect(observe).toHaveBeenCalledWith({ _tag: "Missed", ...schedule })
      expect(result.missed).toBe(1)
    }
  )

  it("leaves the intent due when dispatch or Identity completion is unavailable", async () => {
    const dispatch = await run(Effect.fail("timeout"))
    expect(dispatch.complete).not.toHaveBeenCalled()
    expect(dispatch.observe).toHaveBeenCalledWith({
      _tag: "Failed",
      ...schedule,
    })
    expect(dispatch.result.failed).toBe(1)

    const complete = vi.fn(() => Effect.fail("identity unavailable"))
    const observe = vi.fn(() => Effect.void)
    const result = await Effect.runPromise(
      runScheduledGenerationTick({
        discoverDue: () => Effect.succeed([schedule]),
        create: () => Effect.succeed(job("Succeeded")),
        complete,
        observe,
      })
    )
    expect(observe).toHaveBeenCalledWith({ _tag: "Failed", ...schedule })
    expect(result.failed).toBe(1)
  })
})
