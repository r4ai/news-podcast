import { describe, expect, it, vi } from "vitest"

import { settleJobAction } from "./job-action"

describe("episode job actions", () => {
  it("refreshes jobs and returns a mutation failure instead of rejecting", async () => {
    const failure = new Error("retry response lost")
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(
      settleJobAction(() => Promise.reject(failure), refresh)
    ).resolves.toBe(failure)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("returns a refresh failure when the mutation succeeded", async () => {
    const failure = new Error("refresh failed")

    await expect(
      settleJobAction(
        () => Promise.resolve(),
        () => Promise.reject(failure)
      )
    ).resolves.toBe(failure)
  })

  it("returns undefined when both the mutation and refresh succeed", async () => {
    await expect(
      settleJobAction(
        () => Promise.resolve(),
        () => Promise.resolve()
      )
    ).resolves.toBeUndefined()
  })

  it("preserves the mutation failure when refreshing also fails", async () => {
    const mutationFailure = new Error("retry response lost")
    const refresh = vi.fn().mockRejectedValue(new Error("refresh failed"))

    await expect(
      settleJobAction(() => Promise.reject(mutationFailure), refresh)
    ).resolves.toBe(mutationFailure)
    expect(refresh).toHaveBeenCalledOnce()
  })
})
