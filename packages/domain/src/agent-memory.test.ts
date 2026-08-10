import { describe, expect, it } from "vitest"

import {
  AGENT_MEMORY_KINDS,
  AGENT_MEMORY_STATUSES,
  canAgentAutoActivateMemory,
  initialMemoryStatus,
} from "./agent-memory.js"

describe("agent memory policy", () => {
  it("defines the durable kinds and lifecycle states", () => {
    expect(AGENT_MEMORY_KINDS).toEqual([
      "preference",
      "episode_history",
      "working_note",
    ])
    expect(AGENT_MEMORY_STATUSES).toEqual([
      "proposed",
      "active",
      "rejected",
      "deleted",
    ])
  })

  it.each([
    ["preference", "proposed", false],
    ["episode_history", "active", true],
    ["working_note", "proposed", false],
  ] as const)("applies the %s activation policy", (kind, status, automatic) => {
    expect(initialMemoryStatus(kind)).toBe(status)
    expect(canAgentAutoActivateMemory(kind)).toBe(automatic)
  })
})
