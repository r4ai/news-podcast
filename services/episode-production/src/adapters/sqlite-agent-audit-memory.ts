import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema, Scope } from "effect"

import type {
  AgentAuditMemoryRepository,
  AgentAuditMemoryStoreError,
} from "../application/agent-audit-memory.js"
import {
  AgentAuditEventSchema,
  AgentInstanceSchema,
  AgentMemorySchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  decideAgentMemoryStatus,
  isTerminalAgentRunStatus,
  validatePublicJsonObject,
  type AgentAuditEvent,
  type AgentInstance,
  type AgentMemory,
  type AgentRun,
} from "../domain/agent-audit-memory.js"
import { UtcTimestampSchema } from "../domain/episode-job.js"
import {
  openUnsafeAgentAuditMemoryHandle,
  type AgentEventRow,
  type AgentInstanceRow,
  type AgentMemoryRow,
  type AgentRunRow,
  type UnsafeAgentAuditMemoryHandle,
} from "../infrastructure/unsafe/sqlite-agent-audit-memory.js"

const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

const failure = (
  operation: AgentAuditMemoryStoreError["operation"],
  reason: AgentAuditMemoryStoreError["reason"] = "Unavailable"
): AgentAuditMemoryStoreError =>
  deepFreeze({ _tag: "AgentAuditMemoryStoreFailed", operation, reason })

const parseJsonObject = (
  encoded: string,
  operation: AgentAuditMemoryStoreError["operation"],
  limits: { readonly maxBytes: number; readonly maxDepth: number }
) =>
  Effect.try({
    try: () => JSON.parse(encoded) as unknown,
    catch: () => failure(operation, "CorruptRecord"),
  }).pipe(
    Effect.flatMap((value) => {
      const parsed = validatePublicJsonObject(value, limits)
      return parsed === undefined
        ? Effect.fail(failure(operation, "CorruptRecord"))
        : Effect.succeed(parsed)
    })
  )

const decodeInstance = (
  row: AgentInstanceRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parse(AgentInstanceSchema)(row).pipe(
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const toInstanceRow = (instance: AgentInstance): AgentInstanceRow => ({
  id: instance.id,
  ownerId: instance.ownerId,
  agentKey: instance.agentKey,
  createdAt: encodeTimestamp(instance.createdAt),
  updatedAt: encodeTimestamp(instance.updatedAt),
})

const decodeRun = (
  row: AgentRunRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parse(AgentRunSchema)(row).pipe(
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const toRunRow = (run: AgentRun): AgentRunRow => ({
  id: run.id,
  jobId: run.jobId,
  ownerId: run.ownerId,
  agentInstanceId: run.agentInstanceId,
  model: run.model,
  status: run.status,
  policyHash: run.policyHash,
  createdAt: encodeTimestamp(run.createdAt),
  finishedAt: run.finishedAt === null ? null : encodeTimestamp(run.finishedAt),
  failureCode: run.failureCode,
})

const decodeEvent = (
  row: AgentEventRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parseJsonObject(row.payloadJson, operation, {
    maxBytes: 16 * 1_024,
    maxDepth: 8,
  }).pipe(
    Effect.flatMap((payload) =>
      parse(AgentAuditEventSchema)({
        schemaVersion: 1,
        runId: row.runId,
        sequence: row.sequence,
        type: row.eventType,
        occurredAt: row.occurredAt,
        payload,
      }).pipe(
        Effect.map((event) =>
          deepFreeze({ ...event, payload }) as AgentAuditEvent
        )
      )
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const decodeMemory = (
  row: AgentMemoryRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parseJsonObject(row.contentJson, operation, {
    maxBytes: 8 * 1_024,
    maxDepth: 6,
  }).pipe(
    Effect.flatMap((content) =>
      parse(AgentMemorySchema)({
        id: row.id,
        ownerId: row.ownerId,
        agentInstanceId: row.agentInstanceId,
        kind: row.kind,
        status: row.status,
        version: row.currentVersion,
        content,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }).pipe(
        Effect.map((memory) =>
          deepFreeze({ ...memory, content }) as AgentMemory
        )
      )
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const toMemoryRow = (memory: AgentMemory): AgentMemoryRow => ({
  id: memory.id,
  ownerId: memory.ownerId,
  agentInstanceId: memory.agentInstanceId,
  kind: memory.kind,
  status: memory.status,
  currentVersion: memory.version,
  contentJson: JSON.stringify(memory.content),
  expiresAt:
    memory.expiresAt === null ? null : encodeTimestamp(memory.expiresAt),
  createdAt: encodeTimestamp(memory.createdAt),
  updatedAt: encodeTimestamp(memory.updatedAt),
})

const sameRunCreation = (left: AgentRun, right: AgentRun): boolean =>
  left.id === right.id &&
  left.jobId === right.jobId &&
  left.ownerId === right.ownerId &&
  left.agentInstanceId === right.agentInstanceId &&
  left.model === right.model &&
  left.policyHash === right.policyHash &&
  left.createdAt.epochMilliseconds === right.createdAt.epochMilliseconds

const repositoryFromHandle = (
  handle: UnsafeAgentAuditMemoryHandle
): AgentAuditMemoryRepository => {
  const ensureInstance: AgentAuditMemoryRepository["ensureInstance"] = (
    instance
  ) =>
    Effect.try({
      try: () => handle.ensureInstance(toInstanceRow(instance)),
      catch: () => failure("EnsureInstance"),
    }).pipe(Effect.flatMap((row) => decodeInstance(row, "EnsureInstance")))

  const listInstances: AgentAuditMemoryRepository["listInstances"] = (
    ownerId
  ) =>
    Effect.try({
      try: () => handle.listInstances(ownerId),
      catch: () => failure("ListInstances"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeInstance(row, "ListInstances"), {
          concurrency: 1,
        })
      ),
      Effect.map(deepFreeze)
    )

  const recordRun: AgentAuditMemoryRepository["recordRun"] = (run) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () => handle.recordRun(toRunRow(run)),
        catch: () => failure("RecordRun"),
      })
      if (result._tag === "Created") {
          return deepFreeze({ _tag: "Created" as const, run })
      }
      if (result._tag === "ScopeConflict") {
        return deepFreeze({ _tag: "Conflict" as const })
      }
      const existing = yield* decodeRun(result.row, "RecordRun")
      return sameRunCreation(existing, run)
        ? deepFreeze({ _tag: "Existing" as const, run: existing })
        : deepFreeze({ _tag: "Conflict" as const })
    })

  const getOwnedRun: AgentAuditMemoryRepository["getOwnedRun"] = (
    ownerId,
    runId
  ) =>
    Effect.try({
      try: () => handle.findOwnedRun(ownerId, runId),
      catch: () => failure("GetRun"),
    }).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.succeed(undefined)
          : decodeRun(row, "GetRun")
      )
    )

  const replayOwnedEvents: AgentAuditMemoryRepository["replayOwnedEvents"] = (
    input
  ) =>
    Effect.try({
      try: () => handle.replayOwnedEvents(input),
      catch: () => failure("ReplayEvents"),
    }).pipe(
      Effect.flatMap((rows) =>
        rows === undefined
          ? Effect.succeed(undefined)
          : Effect.forEach(
              rows,
              (row) => decodeEvent(row, "ReplayEvents"),
              { concurrency: 1 }
            ).pipe(Effect.map(deepFreeze))
      )
    )

  const appendOwnedEvent: AgentAuditMemoryRepository["appendOwnedEvent"] = (
    input
  ) =>
    Effect.gen(function* () {
      const row = yield* Effect.try({
        try: () =>
          handle.appendOwnedEvent({
            ownerId: input.ownerId,
            runId: input.runId,
            eventType: input.type,
            payloadJson: JSON.stringify(input.payload),
            occurredAt: encodeTimestamp(input.occurredAt),
          }),
        catch: () => failure("AppendEvent"),
      })
      if (row === undefined) {
        return deepFreeze({ _tag: "NotFound" as const })
      }
      const event = yield* decodeEvent(row, "AppendEvent")
      return deepFreeze({ _tag: "Appended" as const, event })
    })

  const transitionOwnedRun: AgentAuditMemoryRepository["transitionOwnedRun"] =
    (input) =>
      Effect.gen(function* () {
        const result = yield* Effect.try({
          try: () => handle.transitionOwnedRun({
            ownerId: input.ownerId,
            runId: input.runId,
            expected: input.expected,
            next: input.next,
            finishedAt: isTerminalAgentRunStatus(input.next)
              ? encodeTimestamp(input.occurredAt)
              : null,
            failureCode: input.failureCode,
            eventType: input.eventType,
            payloadJson: JSON.stringify(input.eventPayload),
            occurredAt: encodeTimestamp(input.occurredAt),
          }),
          catch: () => failure("TransitionRun"),
        })
        if (result._tag === "NotFound") return deepFreeze(result)
        if (result._tag === "StateConflict") {
          const current = yield* parse(AgentRunStatusSchema)(result.current).pipe(
            Effect.mapError(() => failure("TransitionRun", "CorruptRecord"))
          )
          return deepFreeze({ _tag: "StateConflict" as const, current })
        }
        const [run, event] = yield* Effect.all([
            decodeRun(result.run, "TransitionRun"),
            decodeEvent(result.event, "TransitionRun"),
        ])
        return deepFreeze({ _tag: "Transitioned" as const, run, event })
      })

  const proposeMemory: AgentAuditMemoryRepository["proposeMemory"] = (
    memory
  ) =>
    Effect.try({
      try: () => handle.proposeMemory(toMemoryRow(memory)),
      catch: () => failure("ProposeMemory"),
    }).pipe(Effect.map((created) => (created ? memory : undefined)))

  const listOwnedMemories: AgentAuditMemoryRepository["listOwnedMemories"] = (
    ownerId,
    instanceId
  ) =>
    Effect.gen(function* () {
      const rows = yield* Effect.try({
        try: () => handle.listOwnedMemories(ownerId, instanceId),
        catch: () => failure("ListMemories"),
      })
      if (rows === undefined) return deepFreeze({ _tag: "NotFound" as const })
      const memories = yield* Effect.forEach(
        rows,
        (row) => decodeMemory(row, "ListMemories"),
        { concurrency: 1 }
      )
      return deepFreeze({ _tag: "Found" as const, memories })
    })

  const decideOwnedMemory: AgentAuditMemoryRepository["decideOwnedMemory"] = (
    input
  ) => {
    const nextStatus = decideAgentMemoryStatus("proposed", input.decision)!
    return Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () => handle.decideOwnedMemory({
          ownerId: input.ownerId,
          instanceId: input.instanceId,
          memoryId: input.memoryId,
          nextStatus,
          updatedAt: encodeTimestamp(input.updatedAt),
        }),
        catch: () => failure("DecideMemory"),
      })
      if (result._tag !== "Updated") return deepFreeze(result)
      const memory = yield* decodeMemory(result.row, "DecideMemory")
      return deepFreeze({ _tag: "Updated" as const, memory })
    })
  }

  const softDeleteOwnedMemory: AgentAuditMemoryRepository["softDeleteOwnedMemory"] =
    (input) =>
      Effect.try({
        try: () =>
          handle.softDeleteOwnedMemory({
            ownerId: input.ownerId,
            instanceId: input.instanceId,
            memoryId: input.memoryId,
            updatedAt: encodeTimestamp(input.updatedAt),
          }),
        catch: () => failure("DeleteMemory"),
      }).pipe(
        Effect.map((result) =>
          deepFreeze(
            result === "Deleted"
              ? { _tag: "Deleted" as const }
              : result === "NotFound"
                ? { _tag: "NotFound" as const }
                : { _tag: "StateConflict" as const }
          )
        )
      )

  return deepFreeze({
    ensureInstance,
    listInstances,
    recordRun,
    getOwnedRun,
    replayOwnedEvents,
    appendOwnedEvent,
    transitionOwnedRun,
    proposeMemory,
    listOwnedMemories,
    decideOwnedMemory,
    softDeleteOwnedMemory,
  })
}

export type SqliteAgentAuditMemoryRepository = ReturnType<
  typeof repositoryFromHandle
>

export const sqliteAgentAuditMemoryRepository = (
  databasePath: string
): Effect.Effect<
  SqliteAgentAuditMemoryRepository,
  AgentAuditMemoryStoreError,
  Scope.Scope
> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openUnsafeAgentAuditMemoryHandle(databasePath),
      catch: () => failure("Open"),
    }),
    (handle) => Effect.sync(() => handle.close())
  ).pipe(Effect.map(repositoryFromHandle))
