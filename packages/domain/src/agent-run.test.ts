import { describe, expect, it } from "vitest"

import {
  AGENT_RUN_STATUSES,
  InvalidAgentRunTransitionError,
  isTerminalAgentRunStatus,
  transitionAgentRun,
  type AgentRunStatus,
} from "./agent-run.js"

const allowed: ReadonlyArray<readonly [AgentRunStatus, AgentRunStatus]> = [
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
]

describe("agent run state", () => {
  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(transitionAgentRun(from, to)).toBe(to)
  })

  it("rejects every transition outside the contract", () => {
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}:${to}`))
    for (const from of AGENT_RUN_STATUSES) {
      for (const to of AGENT_RUN_STATUSES) {
        if (!allowedKeys.has(`${from}:${to}`)) {
          expect(() => transitionAgentRun(from, to)).toThrow(
            InvalidAgentRunTransitionError
          )
        }
      }
    }
  })

  it.each([
    ["queued", false],
    ["running", false],
    ["waiting_approval", false],
    ["retrying", false],
    ["succeeded", true],
    ["failed", true],
    ["canceled", true],
  ] as const)("reports terminal state for %s", (status, expected) => {
    expect(isTerminalAgentRunStatus(status)).toBe(expected)
  })
})

