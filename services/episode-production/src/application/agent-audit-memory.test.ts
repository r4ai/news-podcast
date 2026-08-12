import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AgentInstanceIdSchema,
  AgentMemoryIdSchema,
  AgentRunIdSchema,
} from "../domain/agent-audit-memory.js"
import { UtcTimestampSchema } from "../domain/episode-job.js"
import {
  appendAgentAuditEvent,
  replayAgentAuditEvents,
  transitionOwnedAgentRun,
} from "./agent-audit-memory.js"

const runId = Schema.decodeUnknownSync(AgentRunIdSchema)(
  "10000000-0000-4000-8000-000000000001"
)
const now = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-13T00:00:00.000Z"
)

describe("agent audit use cases", () => {
  it("rejects invalid transitions before persistence", async () => {
    const transitionOwnedRun = vi.fn(() =>
      Effect.succeed({ _tag: "NotFound" as const })
    )
    const exit = await Effect.runPromiseExit(
      transitionOwnedAgentRun(
        { transitionOwnedRun },
        {
          ownerId: "owner-1",
          runId,
          expected: "queued",
          next: "succeeded",
          occurredAt: now,
          eventPayload: {},
        }
      )
    )
    expect(exit._tag).toBe("Failure")
    expect(transitionOwnedRun).not.toHaveBeenCalled()
  })

  it("requires a bounded replay page", async () => {
    const replayOwnedEvents = vi.fn(() => Effect.succeed([]))
    await expect(
      Effect.runPromise(
        replayAgentAuditEvents(
          { replayOwnedEvents },
          { ownerId: "owner-1", runId, afterSequence: -1, limit: 101 }
        )
      )
    ).rejects.toBeDefined()
    expect(replayOwnedEvents).not.toHaveBeenCalled()
  })

  it("rejects hidden reasoning before appending an event", async () => {
    const appendOwnedEvent = vi.fn(() =>
      Effect.succeed({ _tag: "NotFound" as const })
    )
    await expect(
      Effect.runPromise(
        appendAgentAuditEvent(
          { appendOwnedEvent },
          {
            ownerId: "owner-1",
            runId,
            type: "tool.completed",
            payload: { internalReasoning: "secret" },
            occurredAt: now,
          }
        )
      )
    ).rejects.toBeDefined()
    expect(appendOwnedEvent).not.toHaveBeenCalled()
  })
})

// Type-level fixtures used by downstream RPC adapters.
void Schema.decodeUnknownSync(AgentInstanceIdSchema)(
  "20000000-0000-4000-8000-000000000001"
)
void Schema.decodeUnknownSync(AgentMemoryIdSchema)(
  "30000000-0000-4000-8000-000000000001"
)
