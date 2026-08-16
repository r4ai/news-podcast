import { EventSchemas } from "@ag-ui/core"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { EpisodeJobAgUiEventSchema } from "./contract.js"

const jobId = "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
const runId = `${jobId}:attempt:1`
const state = {
  jobId,
  status: "running",
  attempt: 1,
  maxAttempts: 4,
  selectionMode: "automatic",
  selectedArticles: [],
} as const

const events = [
  { type: "STATE_SNAPSHOT", timestamp: 1, snapshot: state },
  { type: "RUN_STARTED", timestamp: 2, threadId: jobId, runId },
  { type: "STEP_STARTED", timestamp: 3, stepName: "selecting_articles" },
  { type: "STEP_FINISHED", timestamp: 4, stepName: "selecting_articles" },
  {
    type: "RUN_ERROR",
    timestamp: 5,
    message: "Episode generation will be retried",
    code: "provider_unavailable",
  },
  {
    type: "RUN_FINISHED",
    timestamp: 6,
    threadId: jobId,
    runId,
    outcome: { type: "success" },
  },
] as const

describe("episode job AG-UI contract", () => {
  it.each(events)(
    "keeps $type compatible with official EventSchemas",
    (event) => {
      const decoded = Schema.decodeUnknownSync(EpisodeJobAgUiEventSchema)(event)
      expect(EventSchemas.safeParse(decoded).success).toBe(true)
    }
  )

  it("rejects non-standard extensions and unknown step names", () => {
    expect(() =>
      Schema.decodeUnknownSync(EpisodeJobAgUiEventSchema)({
        type: "CUSTOM",
        name: "job.retrying",
        value: {},
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(EpisodeJobAgUiEventSchema)({
        type: "STEP_STARTED",
        stepName: "researching_sources",
      })
    ).toThrow()
  })
})
