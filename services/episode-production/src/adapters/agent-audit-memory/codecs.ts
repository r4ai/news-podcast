import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { AgentAuditMemoryStoreError } from "../../application/agent-audit-memory.js"
import {
  AgentAuditEventSchema,
  AgentInstanceSchema,
  AgentMemorySchema,
  AgentRunSchema,
  validatePublicJsonObject,
  type AgentAuditEvent,
  type AgentInstance,
  type AgentMemory,
  type AgentRun,
} from "../../domain/agent-audit-memory.js"
import { UtcTimestampSchema } from "../../domain/episode-job.js"
import type {
  AgentEventRow,
  AgentInstanceRow,
  AgentMemoryRow,
  AgentRunRow,
} from "../../infrastructure/unsafe/sqlite-agent-audit-memory.js"

/**
 * SQLiteの行と、監査ドメインの値との相互変換。
 * JSON列は保存された内容をそのまま信じず、大きさと深さを検証してから受け入れる。
 */

export const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

export const failure = (
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

export const decodeInstance = (
  row: AgentInstanceRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parse(AgentInstanceSchema)(row).pipe(
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const toInstanceRow = (instance: AgentInstance): AgentInstanceRow => ({
  id: instance.id,
  ownerId: instance.ownerId,
  agentKey: instance.agentKey,
  createdAt: encodeTimestamp(instance.createdAt),
  updatedAt: encodeTimestamp(instance.updatedAt),
})

export const decodeRun = (
  row: AgentRunRow,
  operation: AgentAuditMemoryStoreError["operation"]
) =>
  parse(AgentRunSchema)(row).pipe(
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const toRunRow = (run: AgentRun): AgentRunRow => ({
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

export const decodeEvent = (
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
        Effect.map(
          (event) => deepFreeze({ ...event, payload }) as AgentAuditEvent
        )
      )
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const decodeMemory = (
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
        Effect.map(
          (memory) => deepFreeze({ ...memory, content }) as AgentMemory
        )
      )
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const toMemoryRow = (memory: AgentMemory): AgentMemoryRow => ({
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

export const sameRunCreation = (left: AgentRun, right: AgentRun): boolean =>
  left.id === right.id &&
  left.jobId === right.jobId &&
  left.ownerId === right.ownerId &&
  left.agentInstanceId === right.agentInstanceId &&
  left.model === right.model &&
  left.policyHash === right.policyHash &&
  left.createdAt.epochMilliseconds === right.createdAt.epochMilliseconds
