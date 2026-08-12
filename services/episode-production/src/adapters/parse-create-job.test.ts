import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseCreateJobCommand } from "./parse-create-job.js"

const valid = {
  ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
  idempotencyKey: "daily-2026-08-12",
  trigger: "manual",
  articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
}

describe("parseCreateJobCommand", () => {
  it("returns only a deeply immutable trusted command", async () => {
    const command = await Effect.runPromise(parseCreateJobCommand(valid))

    expect(command).toEqual(valid)
    expect(Object.isFrozen(command)).toBe(true)
    expect(Object.isFrozen(command.articleIds)).toBe(true)
  })

  it.each([
    ["invalid owner", { ...valid, ownerId: "   " }],
    ["empty key", { ...valid, idempotencyKey: "" }],
    ["unknown trigger", { ...valid, trigger: "cron" }],
    ["empty article selection", { ...valid, articleIds: [] }],
    ["non-UUID article", { ...valid, articleIds: ["article-1"] }],
    [
      "too many selected articles",
      {
        ...valid,
        articleIds: Array.from(
          { length: 21 },
          (_, index) =>
            `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
        ),
      },
    ],
    ["excess input", { ...valid, status: "succeeded" }],
  ])("rejects %s at the boundary", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseCreateJobCommand(input))
    expect(exit._tag).toBe("Failure")
  })
})
