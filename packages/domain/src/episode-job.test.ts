import { describe, expect, it } from "vitest"

import {
  InvalidJobTransitionError,
  isTerminalJobStatus,
  JOB_STATUSES,
  transitionJob,
  type JobStatus,
} from "./episode-job.js"

const allowed: ReadonlyArray<readonly [JobStatus, JobStatus]> = [
  ["queued", "running"],
  ["queued", "canceled"],
  ["running", "succeeded"],
  ["running", "failed"],
  ["running", "canceled"],
]

describe("episode job state", () => {
  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(transitionJob(from, to)).toBe(to)
  })

  it("rejects every transition outside the contract", () => {
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}:${to}`))

    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        if (!allowedKeys.has(`${from}:${to}`)) {
          expect(() => transitionJob(from, to)).toThrow(
            InvalidJobTransitionError
          )
        }
      }
    }
  })

  it.each([
    ["queued", false],
    ["running", false],
    ["succeeded", true],
    ["failed", true],
    ["canceled", true],
  ] as const)("reports terminal state for %s", (status, expected) => {
    expect(isTerminalJobStatus(status)).toBe(expected)
  })
})
