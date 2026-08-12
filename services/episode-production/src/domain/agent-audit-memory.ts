import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Schema } from "effect"

import {
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
} from "./episode-job.js"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

export const AgentInstanceIdSchema = uuid("AgentInstanceId")
export type AgentInstanceId = Schema.Schema.Type<typeof AgentInstanceIdSchema>
export const AgentRunIdSchema = uuid("AgentRunId")
export type AgentRunId = Schema.Schema.Type<typeof AgentRunIdSchema>
export const AgentMemoryIdSchema = uuid("AgentMemoryId")
export type AgentMemoryId = Schema.Schema.Type<typeof AgentMemoryIdSchema>

export const AgentKeySchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)
).pipe(Schema.brand("AgentKey"))
export const AgentModelSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100)
).pipe(Schema.brand("AgentModel"))
export const AgentPolicyHashSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[\w.:/-]+$/)
).pipe(Schema.brand("AgentPolicyHash"))

export const AgentRunStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting_approval",
  "retrying",
  "succeeded",
  "failed",
  "canceled",
])
export type AgentRunStatus = Schema.Schema.Type<typeof AgentRunStatusSchema>

export const AgentRunSchema = Schema.Struct({
  id: AgentRunIdSchema,
  jobId: JobIdSchema,
  ownerId: OwnerIdSchema,
  agentInstanceId: Schema.NullOr(AgentInstanceIdSchema),
  model: AgentModelSchema,
  status: AgentRunStatusSchema,
  policyHash: AgentPolicyHashSchema,
  createdAt: UtcTimestampSchema,
  finishedAt: Schema.NullOr(UtcTimestampSchema),
  failureCode: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
  ),
})
export type AgentRun = DeepReadonly<Schema.Schema.Type<typeof AgentRunSchema>>

export const AgentInstanceSchema = Schema.Struct({
  id: AgentInstanceIdSchema,
  ownerId: OwnerIdSchema,
  agentKey: AgentKeySchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
})
export type AgentInstance = DeepReadonly<
  Schema.Schema.Type<typeof AgentInstanceSchema>
>

export const AgentMemoryKindSchema = Schema.Literals([
  "preference",
  "episode_history",
  "working_note",
])
export type AgentMemoryKind = Schema.Schema.Type<typeof AgentMemoryKindSchema>
export const AgentMemoryStatusSchema = Schema.Literals([
  "proposed",
  "active",
  "rejected",
  "deleted",
])
export type AgentMemoryStatus = Schema.Schema.Type<
  typeof AgentMemoryStatusSchema
>

export type PublicJson =
  | null
  | boolean
  | number
  | string
  | PublicJsonArray
  | PublicJsonObject
export interface PublicJsonArray extends ReadonlyArray<PublicJson> {}
export interface PublicJsonObject extends Readonly<Record<string, PublicJson>> {}

export const AgentMemorySchema = Schema.Struct({
  id: AgentMemoryIdSchema,
  ownerId: OwnerIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  kind: AgentMemoryKindSchema,
  status: AgentMemoryStatusSchema,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  content: Schema.Unknown,
  expiresAt: Schema.NullOr(UtcTimestampSchema),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
})
export type AgentMemory = DeepReadonly<
  Omit<Schema.Schema.Type<typeof AgentMemorySchema>, "content"> & {
    readonly content: PublicJsonObject
  }
>

export const AgentEventTypeSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[a-z][a-z0-9._-]*$/)
).pipe(Schema.brand("AgentEventType"))
export type AgentEventType = Schema.Schema.Type<typeof AgentEventTypeSchema>

export const AgentAuditEventSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: AgentRunIdSchema,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: AgentEventTypeSchema,
  occurredAt: UtcTimestampSchema,
  payload: Schema.Unknown,
})
export type AgentAuditEvent = DeepReadonly<
  Omit<Schema.Schema.Type<typeof AgentAuditEventSchema>, "payload"> & {
    readonly payload: PublicJsonObject
  }
>

const terminalStatuses = new Set<AgentRunStatus>([
  "succeeded",
  "failed",
  "canceled",
])

const allowedTargets: Readonly<
  Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>
> = {
  queued: new Set(["running", "canceled"]),
  running: new Set([
    "waiting_approval",
    "retrying",
    "succeeded",
    "failed",
    "canceled",
  ]),
  waiting_approval: new Set(["queued", "failed", "canceled"]),
  retrying: new Set(["running", "canceled"]),
  succeeded: new Set(),
  failed: new Set(),
  canceled: new Set(),
}

export const canTransitionAgentRun = (
  from: AgentRunStatus,
  to: AgentRunStatus
): boolean => allowedTargets[from].has(to)

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
  terminalStatuses.has(status)

export const initialAgentMemoryStatus = (
  kind: AgentMemoryKind
): AgentMemoryStatus => (kind === "episode_history" ? "active" : "proposed")

export const decideAgentMemoryStatus = (
  current: AgentMemoryStatus,
  decision: "approve" | "reject"
): AgentMemoryStatus | undefined =>
  current === "proposed"
    ? decision === "approve"
      ? "active"
      : "rejected"
    : undefined

export const softDeleteAgentMemoryStatus = (
  current: AgentMemoryStatus
): "deleted" | undefined => (current === "deleted" ? undefined : "deleted")

const forbiddenPublicKeys = new Set([
  "chain_of_thought",
  "chainofthought",
  "hidden_reasoning",
  "internal_reasoning",
  "internal_thoughts",
  "reasoning",
  "scratchpad",
])

const canonicalKey = (key: string) =>
  key
    .replaceAll(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replaceAll(/[-\s]/g, "_")

const inspectPublicJson = (
  value: unknown,
  depth: number,
  maxDepth: number
): value is PublicJson => {
  if (depth > maxDepth) return false
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((item) => inspectPublicJson(item, depth + 1, maxDepth))
  }
  if (typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 100 &&
    entries.every(
      ([key, item]) =>
        key.length > 0 &&
        key.length <= 100 &&
        !forbiddenPublicKeys.has(canonicalKey(key)) &&
        inspectPublicJson(item, depth + 1, maxDepth)
    )
  )
}

export const validatePublicJsonObject = (
  value: unknown,
  limits: { readonly maxBytes: number; readonly maxDepth: number }
): PublicJsonObject | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !inspectPublicJson(value, 0, limits.maxDepth)
  ) {
    return undefined
  }
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, "utf8") > limits.maxBytes) return undefined
  return deepFreeze(value as PublicJsonObject)
}
