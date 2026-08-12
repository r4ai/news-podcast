import { describe, expect, it } from "vitest"

import {
  canTransitionAgentRun,
  decideAgentMemoryStatus,
  initialAgentMemoryStatus,
  isTerminalAgentRunStatus,
  softDeleteAgentMemoryStatus,
  validatePublicJsonObject,
} from "./agent-audit-memory.js"

describe("agent run state machine", () => {
  it.each([
    ["queued", "running"],
    ["queued", "canceled"],
    ["running", "waiting_approval"],
    ["running", "retrying"],
    ["running", "succeeded"],
    ["running", "failed"],
    ["running", "canceled"],
    ["waiting_approval", "queued"],
    ["waiting_approval", "failed"],
    ["waiting_approval", "canceled"],
    ["retrying", "running"],
    ["retrying", "canceled"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionAgentRun(from, to)).toBe(true)
  })

  it.each(["succeeded", "failed", "canceled"] as const)(
    "makes %s terminal",
    (status) => {
      expect(isTerminalAgentRunStatus(status)).toBe(true)
      expect(canTransitionAgentRun(status, "running")).toBe(false)
    }
  )

  it("rejects skipped and self transitions", () => {
    expect(canTransitionAgentRun("queued", "succeeded")).toBe(false)
    expect(canTransitionAgentRun("running", "running")).toBe(false)
  })
})

describe("agent memory state machine", () => {
  it("requires approval for preferences and notes", () => {
    expect(initialAgentMemoryStatus("preference")).toBe("proposed")
    expect(initialAgentMemoryStatus("working_note")).toBe("proposed")
    expect(decideAgentMemoryStatus("proposed", "approve")).toBe("active")
    expect(decideAgentMemoryStatus("proposed", "reject")).toBe("rejected")
  })

  it("auto-activates episode history and prevents repeat decisions", () => {
    expect(initialAgentMemoryStatus("episode_history")).toBe("active")
    expect(decideAgentMemoryStatus("active", "approve")).toBeUndefined()
    expect(decideAgentMemoryStatus("rejected", "approve")).toBeUndefined()
  })

  it("soft deletes only once", () => {
    expect(softDeleteAgentMemoryStatus("active")).toBe("deleted")
    expect(softDeleteAgentMemoryStatus("deleted")).toBeUndefined()
  })
})

describe("public JSON policy", () => {
  it("accepts bounded JSON and deeply freezes it", () => {
    const value = validatePublicJsonObject(
      { summary: "read article", result: { count: 2 } },
      { maxBytes: 1_024, maxDepth: 4 }
    )
    expect(value).toEqual({ summary: "read article", result: { count: 2 } })
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value?.result)).toBe(true)
  })

  it.each([
    { reasoning: "private" },
    { internalThoughts: "private" },
    { nested: { chain_of_thought: "private" } },
    { number: Number.NaN },
    { executable: () => undefined },
  ])("rejects non-public payload %#", (value) => {
    expect(
      validatePublicJsonObject(value, { maxBytes: 1_024, maxDepth: 4 })
    ).toBeUndefined()
  })

  it("rejects byte and depth overflow", () => {
    expect(
      validatePublicJsonObject(
        { value: "é".repeat(20) },
        { maxBytes: 16, maxDepth: 4 }
      )
    ).toBeUndefined()
    expect(
      validatePublicJsonObject(
        { a: { b: { c: true } } },
        { maxBytes: 1_024, maxDepth: 1 }
      )
    ).toBeUndefined()
  })
})
