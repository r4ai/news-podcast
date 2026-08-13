import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { runScheduledGenerationTick } from "./scheduled-generation.js"

describe("scheduled generation tick", () => {
  it("creates every due owner idempotently and completes only successful creation", async () => {
    const complete = vi.fn(() => Effect.void)
    const create = vi.fn((ownerId: string) =>
      ownerId === "owner-fails" ? Effect.fail("unavailable") : Effect.void
    )
    const result = await Effect.runPromise(
      runScheduledGenerationTick({
        discoverDue: () =>
          Effect.succeed([
            { ownerId: "owner-ok", localDate: "2026-08-13" },
            { ownerId: "owner-fails", localDate: "2026-08-13" },
          ]),
        create,
        complete,
        observe: () => Effect.void,
      })
    )

    expect(create).toHaveBeenCalledWith(
      "owner-ok",
      "scheduled:owner-ok:2026-08-13"
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith("owner-ok", "2026-08-13")
    expect(result).toEqual({ discovered: 2, completed: 1, failed: 1 })
  })

  it("does not mark complete when idempotent creation remains unavailable", async () => {
    const complete = vi.fn(() => Effect.void)
    const result = await Effect.runPromise(
      runScheduledGenerationTick({
        discoverDue: () =>
          Effect.succeed([{ ownerId: "owner-1", localDate: "2026-08-13" }]),
        create: () => Effect.fail("timeout"),
        complete,
        observe: () => Effect.void,
      })
    )
    expect(complete).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })
})
