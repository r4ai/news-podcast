import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseCreateJobCommand } from "./parse-create-job.js"

const valid = {
  ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
  idempotencyKey: "daily-2026-08-12",
  trigger: "manual",
}

describe("parseCreateJobCommand", () => {
  it("returns only a deeply immutable trusted command", async () => {
    const command = await Effect.runPromise(parseCreateJobCommand(valid))

    expect(command).toEqual(valid)
    expect(Object.isFrozen(command)).toBe(true)
  })

  it.each([
    ["invalid owner", { ...valid, ownerId: "owner-1" }],
    ["empty key", { ...valid, idempotencyKey: "" }],
    ["unknown trigger", { ...valid, trigger: "cron" }],
    ["excess input", { ...valid, status: "succeeded" }],
  ])("rejects %s at the boundary", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseCreateJobCommand(input))
    expect(exit._tag).toBe("Failure")
  })
})
