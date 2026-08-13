import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  AgentEventTypeSchema,
  AgentInstanceIdSchema,
  AgentInstanceSchema,
  AgentKeySchema,
  AgentMemoryIdSchema,
  AgentModelSchema,
  AgentPolicyHashSchema,
  AgentRunIdSchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentAuditEvent,
  type AgentInstance,
  type AgentInstanceId,
  type AgentMemory,
  type AgentMemoryId,
  type AgentRun,
  type AgentRunId,
  type AgentRunStatus,
  type PublicJsonObject,
  canTransitionAgentRun,
  initialAgentMemoryStatus,
  validatePublicJsonObject,
} from "../domain/agent-audit-memory.js"
import {
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  type OwnerId,
  type UtcTimestamp,
} from "../domain/episode-job.js"

export type AgentAuditMemoryStoreError = DeepReadonly<{
  readonly _tag: "AgentAuditMemoryStoreFailed"
  readonly operation:
    | "Open"
    | "EnsureInstance"
    | "ListInstances"
    | "RecordRun"
    | "GetRun"
    | "ReplayEvents"
    | "AppendEvent"
    | "TransitionRun"
    | "ProposeMemory"
    | "ListMemories"
    | "DecideMemory"
    | "DeleteMemory"
  readonly reason: "Unavailable" | "CorruptRecord"
}>

export type RecordAgentRunResult = DeepReadonly<
  | { readonly _tag: "Created"; readonly run: AgentRun }
  | { readonly _tag: "Existing"; readonly run: AgentRun }
  | { readonly _tag: "Conflict" }
>
export type AppendAgentAuditEventResult = DeepReadonly<
  | { readonly _tag: "Appended"; readonly event: AgentAuditEvent }
  | { readonly _tag: "NotFound" }
>
export type TransitionAgentRunResult = DeepReadonly<
  | {
      readonly _tag: "Transitioned"
      readonly run: AgentRun
      readonly event: AgentAuditEvent
    }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "StateConflict"; readonly current: AgentRunStatus }
>
export type ListAgentMemoriesResult = DeepReadonly<
  | { readonly _tag: "Found"; readonly memories: readonly AgentMemory[] }
  | { readonly _tag: "NotFound" }
>
export type DecideAgentMemoryResult = DeepReadonly<
  | { readonly _tag: "Updated"; readonly memory: AgentMemory }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "StateConflict" }
>
export type DeleteAgentMemoryResult = DeepReadonly<
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "StateConflict" }
>

export type AgentAuditMemoryRepository = DeepReadonly<{
  readonly ensureInstance: (
    instance: AgentInstance
  ) => Effect.Effect<AgentInstance, AgentAuditMemoryStoreError>
  readonly listInstances: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly AgentInstance[], AgentAuditMemoryStoreError>
  readonly recordRun: (
    run: AgentRun
  ) => Effect.Effect<RecordAgentRunResult, AgentAuditMemoryStoreError>
  readonly getOwnedRun: (
    ownerId: OwnerId,
    runId: AgentRunId
  ) => Effect.Effect<AgentRun | undefined, AgentAuditMemoryStoreError>
  readonly replayOwnedEvents: (input: {
    readonly ownerId: OwnerId
    readonly runId: AgentRunId
    readonly afterSequence: number
    readonly limit: number
  }) => Effect.Effect<
    readonly AgentAuditEvent[] | undefined,
    AgentAuditMemoryStoreError
  >
  readonly appendOwnedEvent: (input: {
    readonly ownerId: OwnerId
    readonly runId: AgentRunId
    readonly type: AgentAuditEvent["type"]
    readonly payload: PublicJsonObject
    readonly occurredAt: UtcTimestamp
  }) => Effect.Effect<AppendAgentAuditEventResult, AgentAuditMemoryStoreError>
  readonly transitionOwnedRun: (input: {
    readonly ownerId: OwnerId
    readonly runId: AgentRunId
    readonly expected: AgentRunStatus
    readonly next: AgentRunStatus
    readonly occurredAt: UtcTimestamp
    readonly failureCode: string | null
    readonly eventType: AgentAuditEvent["type"]
    readonly eventPayload: PublicJsonObject
  }) => Effect.Effect<TransitionAgentRunResult, AgentAuditMemoryStoreError>
  readonly proposeMemory: (
    memory: AgentMemory
  ) => Effect.Effect<AgentMemory | undefined, AgentAuditMemoryStoreError>
  readonly listOwnedMemories: (
    ownerId: OwnerId,
    instanceId: AgentInstanceId
  ) => Effect.Effect<ListAgentMemoriesResult, AgentAuditMemoryStoreError>
  readonly decideOwnedMemory: (input: {
    readonly ownerId: OwnerId
    readonly instanceId: AgentInstanceId
    readonly memoryId: AgentMemoryId
    readonly decision: "approve" | "reject"
    readonly updatedAt: UtcTimestamp
  }) => Effect.Effect<DecideAgentMemoryResult, AgentAuditMemoryStoreError>
  readonly softDeleteOwnedMemory: (input: {
    readonly ownerId: OwnerId
    readonly instanceId: AgentInstanceId
    readonly memoryId: AgentMemoryId
    readonly updatedAt: UtcTimestamp
  }) => Effect.Effect<DeleteAgentMemoryResult, AgentAuditMemoryStoreError>
}>

const EnsureAgentInstanceSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  agentKey: AgentKeySchema,
})
const RecordAgentRunSchema = Schema.Struct({
  id: AgentRunIdSchema,
  jobId: JobIdSchema,
  ownerId: OwnerIdSchema,
  agentInstanceId: Schema.NullOr(AgentInstanceIdSchema),
  model: AgentModelSchema,
  policyHash: AgentPolicyHashSchema,
  createdAt: UtcTimestampSchema,
})
const OwnedRunSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  runId: AgentRunIdSchema,
})
const ReplayAgentEventsSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  runId: AgentRunIdSchema,
  afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
  limit: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100)
  ),
})
const AppendAgentEventSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  runId: AgentRunIdSchema,
  type: AgentEventTypeSchema,
  payload: Schema.Unknown,
  occurredAt: UtcTimestampSchema,
})
const TransitionAgentRunSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  runId: AgentRunIdSchema,
  expected: AgentRunStatusSchema,
  next: AgentRunStatusSchema,
  occurredAt: UtcTimestampSchema,
  failureCode: Schema.optional(
    Schema.String.check(
      Schema.isTrimmed(),
      Schema.isMinLength(1),
      Schema.isMaxLength(100)
    )
  ),
  eventPayload: Schema.Unknown,
})
const ProposeMemorySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  kind: Schema.Literals(["preference", "working_note"]),
  content: Schema.Unknown,
  expiresAt: Schema.optional(UtcTimestampSchema),
})
const OwnedInstanceSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
})
const DecideMemorySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  memoryId: AgentMemoryIdSchema,
  decision: Schema.Literals(["approve", "reject"]),
})
const DeleteMemorySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  agentInstanceId: AgentInstanceIdSchema,
  memoryId: AgentMemoryIdSchema,
})
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

const invalidPublicPayload = (kind: "event" | "memory") =>
  deepFreeze({ _tag: "InvalidPublicAgentPayload" as const, kind })
const invalidTransition = (from: AgentRunStatus, to: AgentRunStatus) =>
  deepFreeze({ _tag: "InvalidAgentRunTransition" as const, from, to })
const invalidFailureCode = () =>
  deepFreeze({ _tag: "InvalidAgentRunFailureCode" as const })

export const ensureAgentInstance = (
  ports: Pick<AgentAuditMemoryRepository, "ensureInstance"> & {
    readonly nextInstanceId: Effect.Effect<AgentInstanceId>
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  parse(EnsureAgentInstanceSchema)(input).pipe(
    Effect.flatMap((command) =>
      Effect.all([ports.nextInstanceId, ports.now]).pipe(
        Effect.flatMap(([id, now]) =>
          parse(AgentInstanceSchema)({
            id,
            ownerId: command.ownerId,
            agentKey: command.agentKey,
            createdAt: encodeTimestamp(now),
            updatedAt: encodeTimestamp(now),
          })
        ),
        Effect.flatMap(ports.ensureInstance)
      )
    )
  )

export const listAgentInstances = (
  repository: Pick<AgentAuditMemoryRepository, "listInstances">,
  ownerId: unknown
) =>
  parse(OwnerIdSchema)(ownerId).pipe(
    Effect.flatMap((parsedOwnerId) => repository.listInstances(parsedOwnerId))
  )

export const recordAgentRun = (
  repository: Pick<AgentAuditMemoryRepository, "recordRun">,
  input: unknown
) =>
  parse(RecordAgentRunSchema)(input).pipe(
    Effect.flatMap((command) =>
      parse(AgentRunSchema)({
        ...command,
        createdAt: encodeTimestamp(command.createdAt),
        status: "queued",
        finishedAt: null,
        failureCode: null,
      })
    ),
    Effect.flatMap(repository.recordRun)
  )

export const getOwnedAgentRun = (
  repository: Pick<AgentAuditMemoryRepository, "getOwnedRun">,
  input: unknown
) =>
  parse(OwnedRunSchema)(input).pipe(
    Effect.flatMap(({ ownerId, runId }) =>
      repository.getOwnedRun(ownerId, runId)
    )
  )

export const replayAgentAuditEvents = (
  repository: Pick<AgentAuditMemoryRepository, "replayOwnedEvents">,
  input: unknown
) =>
  parse(ReplayAgentEventsSchema)(input).pipe(
    Effect.flatMap(repository.replayOwnedEvents)
  )

export const appendAgentAuditEvent = (
  repository: Pick<AgentAuditMemoryRepository, "appendOwnedEvent">,
  input: unknown
) =>
  Effect.gen(function* () {
    const command = yield* parse(AppendAgentEventSchema)(input)
    const payload = validatePublicJsonObject(command.payload, {
      maxBytes: 16 * 1_024,
      maxDepth: 8,
    })
    if (payload === undefined) {
      return yield* Effect.fail(invalidPublicPayload("event"))
    }
    return yield* repository.appendOwnedEvent({ ...command, payload })
  })

export const transitionOwnedAgentRun = (
  repository: Pick<AgentAuditMemoryRepository, "transitionOwnedRun">,
  input: unknown
) =>
  Effect.gen(function* () {
    const command = yield* parse(TransitionAgentRunSchema)(input)
    if (!canTransitionAgentRun(command.expected, command.next)) {
      return yield* Effect.fail(
        invalidTransition(command.expected, command.next)
      )
    }
    if ((command.next === "failed") !== (command.failureCode !== undefined)) {
      return yield* Effect.fail(invalidFailureCode())
    }
    const eventPayload = validatePublicJsonObject(command.eventPayload, {
      maxBytes: 16 * 1_024,
      maxDepth: 8,
    })
    if (eventPayload === undefined) {
      return yield* Effect.fail(invalidPublicPayload("event"))
    }
    return yield* repository.transitionOwnedRun({
      ownerId: command.ownerId,
      runId: command.runId,
      expected: command.expected,
      next: command.next,
      occurredAt: command.occurredAt,
      failureCode: command.failureCode ?? null,
      eventType: Schema.decodeUnknownSync(AgentEventTypeSchema)(
        `run.${command.next}`
      ),
      eventPayload,
    })
  })

export const proposeAgentMemory = (
  ports: Pick<AgentAuditMemoryRepository, "proposeMemory"> & {
    readonly nextMemoryId: Effect.Effect<AgentMemoryId>
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  Effect.gen(function* () {
    const command = yield* parse(ProposeMemorySchema)(input)
    const content = validatePublicJsonObject(command.content, {
      maxBytes: 8 * 1_024,
      maxDepth: 6,
    })
    if (content === undefined) {
      return yield* Effect.fail(invalidPublicPayload("memory"))
    }
    const [id, now] = yield* Effect.all([ports.nextMemoryId, ports.now])
    return yield* ports.proposeMemory(
      deepFreeze({
        id,
        ownerId: command.ownerId,
        agentInstanceId: command.agentInstanceId,
        kind: command.kind,
        status: initialAgentMemoryStatus(command.kind),
        version: 1,
        content,
        expiresAt: command.expiresAt ?? null,
        createdAt: now,
        updatedAt: now,
      } satisfies AgentMemory)
    )
  })

export const listAgentMemories = (
  repository: Pick<AgentAuditMemoryRepository, "listOwnedMemories">,
  input: unknown
) =>
  parse(OwnedInstanceSchema)(input).pipe(
    Effect.flatMap(({ ownerId, agentInstanceId }) =>
      repository.listOwnedMemories(ownerId, agentInstanceId)
    )
  )

export const decideAgentMemory = (
  ports: Pick<AgentAuditMemoryRepository, "decideOwnedMemory"> & {
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  parse(DecideMemorySchema)(input).pipe(
    Effect.flatMap((command) =>
      ports.now.pipe(
        Effect.flatMap((updatedAt) =>
          ports.decideOwnedMemory({
            ownerId: command.ownerId,
            instanceId: command.agentInstanceId,
            memoryId: command.memoryId,
            decision: command.decision,
            updatedAt,
          })
        )
      )
    )
  )

export const softDeleteAgentMemory = (
  ports: Pick<AgentAuditMemoryRepository, "softDeleteOwnedMemory"> & {
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  parse(DeleteMemorySchema)(input).pipe(
    Effect.flatMap((command) =>
      ports.now.pipe(
        Effect.flatMap((updatedAt) =>
          ports.softDeleteOwnedMemory({
            ownerId: command.ownerId,
            instanceId: command.agentInstanceId,
            memoryId: command.memoryId,
            updatedAt,
          })
        )
      )
    )
  )
