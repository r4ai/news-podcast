import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import {
  appendAgentAuditEvent,
  decideAgentMemory,
  ensureAgentInstance,
  getOwnedAgentRun,
  listAgentMemories,
  proposeAgentMemory,
  recordAgentRun,
  replayAgentAuditEvents,
  softDeleteAgentMemory,
  transitionOwnedAgentRun,
} from "../application/agent-audit-memory.js"
import {
  AgentInstanceIdSchema,
  AgentMemoryIdSchema,
  AgentRunIdSchema,
} from "../domain/agent-audit-memory.js"
import { JobIdSchema, UtcTimestampSchema } from "../domain/episode-job.js"
import { openSqliteJobHandle } from "../infrastructure/unsafe/sqlite.js"
import { sqliteAgentAuditMemoryRepository } from "./sqlite-agent-audit-memory.js"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10000000-0000-4000-8000-000000000001"
)
const runId = Schema.decodeUnknownSync(AgentRunIdSchema)(
  "20000000-0000-4000-8000-000000000001"
)
const instanceId = Schema.decodeUnknownSync(AgentInstanceIdSchema)(
  "30000000-0000-4000-8000-000000000001"
)
const memoryId = Schema.decodeUnknownSync(AgentMemoryIdSchema)(
  "40000000-0000-4000-8000-000000000001"
)
const now = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-13T00:00:00.000Z"
)
const later = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-13T00:01:00.000Z"
)

describe("sqlite agent audit and memory repository", () => {
  it("records an owner-scoped run and atomically sequences public events", async () => {
    const databasePath = createDatabase()

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository =
            yield* sqliteAgentAuditMemoryRepository(databasePath)
          const instance = yield* ensureAgentInstance(
            {
              ...repository,
              nextInstanceId: Effect.succeed(instanceId),
              now: Effect.succeed(now),
            },
            { ownerId: "owner-1", agentKey: "podcast-editor" }
          )
          const recorded = yield* recordAgentRun(repository, {
            id: runId,
            jobId,
            ownerId: "owner-1",
            agentInstanceId: instance.id,
            model: "gpt-test",
            policyHash: "policy:v1",
            createdAt: "2026-08-13T00:00:00.000Z",
          })
          const duplicate = yield* recordAgentRun(repository, {
            id: runId,
            jobId,
            ownerId: "owner-1",
            agentInstanceId: instance.id,
            model: "gpt-test",
            policyHash: "policy:v1",
            createdAt: "2026-08-13T00:00:00.000Z",
          })
          const crossOwnerRecord = yield* recordAgentRun(repository, {
            id: "20000000-0000-4000-8000-000000000002",
            jobId,
            ownerId: "owner-2",
            agentInstanceId: null,
            model: "gpt-test",
            policyHash: "policy:v1",
            createdAt: "2026-08-13T00:00:00.000Z",
          })
          const hidden = yield* getOwnedAgentRun(repository, {
            ownerId: "owner-2",
            runId,
          })
          const appended = yield* appendAgentAuditEvent(repository, {
            ownerId: "owner-1",
            runId,
            type: "tool.completed",
            payload: { tool: "read_article", result: { articleCount: 2 } },
            occurredAt: "2026-08-13T00:00:00.000Z",
          })
          const transitioned = yield* transitionOwnedAgentRun(repository, {
            ownerId: "owner-1",
            runId,
            expected: "queued",
            next: "running",
            occurredAt: "2026-08-13T00:01:00.000Z",
            eventPayload: { attempt: 1 },
          })
          const stale = yield* transitionOwnedAgentRun(repository, {
            ownerId: "owner-1",
            runId,
            expected: "queued",
            next: "running",
            occurredAt: "2026-08-13T00:01:00.000Z",
            eventPayload: { attempt: 1 },
          })
          const replay = yield* replayAgentAuditEvents(repository, {
            ownerId: "owner-1",
            runId,
            afterSequence: -1,
            limit: 100,
          })
          return {
            recorded,
            duplicate,
            crossOwnerRecord,
            hidden,
            appended,
            transitioned,
            stale,
            replay,
          }
        })
      )
    )

    expect(result.recorded._tag).toBe("Created")
    expect(result.duplicate._tag).toBe("Existing")
    expect(result.crossOwnerRecord).toEqual({ _tag: "Conflict" })
    expect(result.hidden).toBeUndefined()
    expect(result.appended).toMatchObject({
      _tag: "Appended",
      event: { sequence: 0, payload: { tool: "read_article" } },
    })
    expect(result.transitioned).toMatchObject({
      _tag: "Transitioned",
      run: { status: "running", finishedAt: null },
      event: { sequence: 1, type: "run.running" },
    })
    expect(result.stale).toMatchObject({
      _tag: "StateConflict",
      current: "running",
    })
    expect(result.replay).toMatchObject([
      { sequence: 0, type: "tool.completed" },
      { sequence: 1, type: "run.running" },
    ])
    expect(Object.isFrozen(result.replay)).toBe(true)
  })

  it("runs the owner and instance scoped memory lifecycle transactionally", async () => {
    const databasePath = createDatabase()
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository =
            yield* sqliteAgentAuditMemoryRepository(databasePath)
          yield* ensureAgentInstance(
            {
              ...repository,
              nextInstanceId: Effect.succeed(instanceId),
              now: Effect.succeed(now),
            },
            { ownerId: "owner-1", agentKey: "podcast-editor" }
          )
          const proposal = yield* proposeAgentMemory(
            {
              ...repository,
              nextMemoryId: Effect.succeed(memoryId),
              now: Effect.succeed(now),
            },
            {
              ownerId: "owner-1",
              agentInstanceId: instanceId,
              kind: "preference",
              content: { preferredTopics: ["AI", "Rust"] },
            }
          )
          const crossOwner = yield* listAgentMemories(repository, {
            ownerId: "owner-2",
            agentInstanceId: instanceId,
          })
          const approval = yield* decideAgentMemory(
            { ...repository, now: Effect.succeed(later) },
            {
              ownerId: "owner-1",
              agentInstanceId: instanceId,
              memoryId,
              decision: "approve",
            }
          )
          const repeated = yield* decideAgentMemory(
            { ...repository, now: Effect.succeed(later) },
            {
              ownerId: "owner-1",
              agentInstanceId: instanceId,
              memoryId,
              decision: "approve",
            }
          )
          const deletion = yield* softDeleteAgentMemory(
            { ...repository, now: Effect.succeed(later) },
            { ownerId: "owner-1", agentInstanceId: instanceId, memoryId }
          )
          const listed = yield* listAgentMemories(repository, {
            ownerId: "owner-1",
            agentInstanceId: instanceId,
          })
          return { proposal, crossOwner, approval, repeated, deletion, listed }
        })
      )
    )

    expect(result.proposal).toMatchObject({ status: "proposed", version: 1 })
    expect(Object.isFrozen(result.proposal?.content)).toBe(true)
    expect(result.crossOwner).toEqual({ _tag: "NotFound" })
    expect(result.approval).toMatchObject({
      _tag: "Updated",
      memory: { status: "active" },
    })
    expect(result.repeated).toEqual({ _tag: "StateConflict" })
    expect(result.deletion).toEqual({ _tag: "Deleted" })
    expect(result.listed).toEqual({ _tag: "Found", memories: [] })
  })
})

const createDatabase = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "production-agent-audit-"))
  directories.push(directory)
  const databasePath = join(directory, "production.sqlite")
  const jobs = openSqliteJobHandle(databasePath)
  jobs.saveIdempotently({
    ownerId: "owner-1",
    idempotencyKey: "agent-audit-test",
    requestFingerprint: "test",
    jobId,
    document: "{}",
  })
  jobs.close()
  return databasePath
}
