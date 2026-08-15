import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { AgentAuditReplySchema, subjects } from "@news-podcast/protocols"

import { CreateAgentMemorySchema } from "../../contract.js"

import { makeNatsGatewayPorts } from "../nats-gateway-ports.js"
import {
  type CapturedRequest,
  dependencies,
  encodedReply,
  fakeClient,
  sessionHeaders,
  userId,
  userSessionReply,
} from "./port-test-harness.js"

const agentInstanceId = "1f1b6f60-9a4c-4a53-bd0f-2b2f0a4a5c11"
const runId = "2f1b6f60-9a4c-4a53-bd0f-2b2f0a4a5c22"
const memoryId = "3f1b6f60-9a4c-4a53-bd0f-2b2f0a4a5c33"
const jobId = "4f1b6f60-9a4c-4a53-bd0f-2b2f0a4a5c44"

const instance = {
  id: agentInstanceId,
  agentKey: "producer",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:01.000Z",
} as const

const run = {
  id: runId,
  jobId,
  agentInstanceId,
  model: "claude-opus-5",
  status: "succeeded",
  policyHash: "b3d1",
  createdAt: "2026-08-12T00:00:00.000Z",
  finishedAt: "2026-08-12T00:00:05.000Z",
  failureCode: null,
} as const

const memory = {
  id: memoryId,
  agentInstanceId,
  kind: "preference",
  status: "active",
  version: 2,
  content: { tone: "calm", weight: 3, muted: false, note: null },
  expiresAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:01.000Z",
} as const

const runEvent = {
  schemaVersion: 1,
  runId,
  sequence: 7,
  type: "agent.step",
  occurredAt: "2026-08-12T00:00:02.000Z",
  payload: { step: "plan" },
} as const

const portsFor = (
  replyFor: (payload: Record<string, unknown>) => unknown,
  requests: CapturedRequest[] = []
) =>
  makeNatsGatewayPorts(
    fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      requests.push(request)
      return encodedReply(
        request.envelope,
        "episode-production",
        AgentAuditReplySchema,
        replyFor(request.envelope.payload as Record<string, unknown>)
      )
    }),
    dependencies()
  )

describe("NATS GatewayPorts agent audit and memory", () => {
  it("routes every audit operation to the owner-scoped audit subject", async () => {
    const requests: CapturedRequest[] = []
    const ports = portsFor(
      (payload) =>
        payload.operation === "ListInstances"
          ? { _tag: "Instances", instances: [instance] }
          : payload.operation === "GetRun"
            ? { _tag: "Run", run }
            : payload.operation === "ReplayEvents"
              ? { _tag: "Events", events: [runEvent] }
              : payload.operation === "ListMemories"
                ? { _tag: "Memories", memories: [memory] }
                : payload.operation === "DeleteMemory"
                  ? { _tag: "Deleted" }
                  : { _tag: "Memory", memory },
      requests
    )

    const [instances, foundRun, events, memories, created, approved] =
      await Effect.runPromise(
        Effect.all(
          [
            ports.listAgentInstances(sessionHeaders),
            ports.getAgentRun({ headers: sessionHeaders, runId }),
            ports.replayAgentRunEvents({
              headers: sessionHeaders,
              runId,
              afterSequence: 0,
            }),
            ports.listAgentMemories({
              headers: sessionHeaders,
              agentInstanceId,
            }),
            ports.createAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              payload: { kind: "preference", content: { tone: "calm" } },
            }),
            ports.approveAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              memoryId,
            }),
          ],
          { concurrency: 1 }
        )
      )
    await Effect.runPromise(
      ports.deleteAgentMemory({
        headers: sessionHeaders,
        agentInstanceId,
        memoryId,
      })
    )

    expect(requests).toHaveLength(7)
    for (const request of requests) {
      expect(request.subject).toBe(subjects.production.agentAuditMemory)
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      expect(request.envelope.payload).not.toHaveProperty("ownerId")
    }
    expect(instances.items).toEqual([instance])
    expect(foundRun.id).toBe(runId)
    expect(events).toEqual([runEvent])
    expect(memories.items[0]!.id).toBe(memoryId)
    expect(created.id).toBe(memoryId)
    expect(approved.status).toBe("active")
  })

  it("bounds a replay request to at most one hundred events", async () => {
    const requests: CapturedRequest[] = []
    const ports = portsFor(() => ({ _tag: "Events", events: [] }), requests)

    await Effect.runPromise(
      ports.replayAgentRunEvents({
        headers: sessionHeaders,
        runId,
        afterSequence: 12,
      })
    )

    expect(requests[0]!.envelope.payload).toEqual({
      operation: "ReplayEvents",
      runId,
      afterSequence: 12,
      limit: 100,
    })
  })

  it("carries the create-memory payload through without reshaping it", async () => {
    const requests: CapturedRequest[] = []
    const ports = portsFor(() => ({ _tag: "Memory", memory }), requests)

    await Effect.runPromise(
      ports.createAgentMemory({
        headers: sessionHeaders,
        agentInstanceId,
        payload: Schema.decodeUnknownSync(CreateAgentMemorySchema)({
          kind: "working_note",
          content: { note: "draft" },
          expiresAt: "2026-09-12T00:00:00.000Z",
        }),
      })
    )

    expect(requests[0]!.envelope.payload).toEqual({
      operation: "CreateMemory",
      agentInstanceId,
      kind: "working_note",
      content: { note: "draft" },
      expiresAt: "2026-09-12T00:00:00.000Z",
    })
  })

  it("reports a missing run or memory as a 404 without leaking the upstream tag", async () => {
    const ports = portsFor(() => ({ _tag: "NotFound" }))

    const failures = await Effect.runPromise(
      Effect.all(
        [
          Effect.flip(ports.getAgentRun({ headers: sessionHeaders, runId })),
          Effect.flip(
            ports.replayAgentRunEvents({
              headers: sessionHeaders,
              runId,
              afterSequence: 0,
            })
          ),
          Effect.flip(
            ports.listAgentMemories({
              headers: sessionHeaders,
              agentInstanceId,
            })
          ),
          Effect.flip(
            ports.createAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              payload: { kind: "preference", content: {} },
            })
          ),
          Effect.flip(
            ports.approveAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              memoryId,
            })
          ),
          Effect.flip(
            ports.deleteAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              memoryId,
            })
          ),
        ],
        { concurrency: 1 }
      )
    )

    for (const failure of failures) {
      expect(failure).toMatchObject({ status: 404, code: "episode_not_found" })
    }
  })

  it("reports a memory lifecycle conflict as a 409 on the mutating operations", async () => {
    const ports = portsFor(() => ({ _tag: "Conflict" }))

    const [approve, remove] = await Effect.runPromise(
      Effect.all(
        [
          Effect.flip(
            ports.approveAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              memoryId,
            })
          ),
          Effect.flip(
            ports.deleteAgentMemory({
              headers: sessionHeaders,
              agentInstanceId,
              memoryId,
            })
          ),
        ],
        { concurrency: 1 }
      )
    )

    expect(approve).toMatchObject({ status: 409, code: "idempotency_conflict" })
    expect(remove).toMatchObject({ status: 409, code: "idempotency_conflict" })
  })

  it("degrades a rejected audit reply to a 503 for every operation", async () => {
    const ports = portsFor(() => ({
      _tag: "Rejected",
      code: "STORAGE_FAILURE",
    }))

    const failures = await Effect.runPromise(
      Effect.all(
        [
          Effect.flip(ports.listAgentInstances(sessionHeaders)),
          Effect.flip(ports.getAgentRun({ headers: sessionHeaders, runId })),
          Effect.flip(
            ports.listAgentMemories({
              headers: sessionHeaders,
              agentInstanceId,
            })
          ),
        ],
        { concurrency: 1 }
      )
    )

    for (const failure of failures) {
      expect(failure).toMatchObject({
        status: 503,
        code: "upstream_unavailable",
      })
    }
  })
})
