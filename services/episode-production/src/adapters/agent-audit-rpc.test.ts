import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { ensureAgentInstance } from "../application/agent-audit-memory.js"
import {
  AgentInstanceIdSchema,
  AgentMemoryIdSchema,
} from "../domain/agent-audit-memory.js"
import { UtcTimestampSchema } from "../domain/episode-job.js"
import { openSqliteJobHandle } from "../infrastructure/unsafe/sqlite.js"
import { sqliteAgentAuditMemoryRepository } from "./sqlite-agent-audit-memory.js"
import { makeAgentAuditRpcHandler } from "./agent-audit-rpc.js"

const directories: string[] = []
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
)
const timestamp = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-13T00:00:00.000Z"
)
const instanceId = Schema.decodeUnknownSync(AgentInstanceIdSchema)(
  "ba9c791d-2957-4358-a789-ffb9bfd7b35c"
)
const memoryId = Schema.decodeUnknownSync(AgentMemoryIdSchema)(
  "32c688c5-3524-42db-9301-35613e9797b5"
)

const envelope = (userId: string, payload: unknown) =>
  JSON.stringify({
    messageId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
    correlationId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
    causationId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
    occurredAt: "2026-08-13T00:00:00.000Z",
    producer: "gateway",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "User", userId },
    payload,
  })

describe("agent audit RPC", () => {
  it("lists only actor-owned instances and rejects reasoning memory payloads", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-rpc-"))
    directories.push(directory)
    const path = join(directory, "production.sqlite")
    openSqliteJobHandle(path).close()
    const replies: unknown[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* sqliteAgentAuditMemoryRepository(path)
          yield* ensureAgentInstance(
            {
              ...repository,
              nextInstanceId: Effect.succeed(instanceId),
              now: Effect.succeed(timestamp),
            },
            { ownerId: "owner-a", agentKey: "podcast-editor" }
          )
          const handler = makeAgentAuditRpcHandler(repository, {
            newMessageId: () => "20e2d4e1-c127-479f-a124-2ea037bd9319",
            nextMemoryId: Effect.succeed(memoryId),
            now: Effect.succeed(timestamp),
            nowString: () => "2026-08-13T00:00:00.000Z",
          })
          const invoke = (payload: string) =>
            handler({
              payload,
              reply: (reply) =>
                Effect.sync(() => void replies.push(JSON.parse(reply))),
            })
          yield* invoke(envelope("owner-b", { operation: "ListInstances" }))
          yield* invoke(
            envelope("owner-a", {
              operation: "CreateMemory",
              agentInstanceId: instanceId,
              kind: "preference",
              content: { reasoning: "secret" },
            })
          )
        })
      )
    )

    expect((replies[0] as { payload: unknown }).payload).toEqual({
      _tag: "Instances",
      instances: [],
    })
    expect((replies[1] as { payload: unknown }).payload).toEqual({
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })
})
