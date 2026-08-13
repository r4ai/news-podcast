import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = Schema.String.check(Schema.isUUID(4))
const instant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
)
const instance = Schema.Struct({
  id: uuid,
  agentKey: Schema.String,
  createdAt: instant,
  updatedAt: instant,
})
const run = Schema.Struct({
  id: uuid,
  jobId: uuid,
  agentInstanceId: Schema.NullOr(uuid),
  model: Schema.String,
  status: Schema.Literals([
    "queued",
    "running",
    "waiting_approval",
    "retrying",
    "succeeded",
    "failed",
    "canceled",
  ]),
  policyHash: Schema.String,
  createdAt: instant,
  finishedAt: Schema.NullOr(instant),
  failureCode: Schema.NullOr(Schema.String),
})
const memory = Schema.Struct({
  id: uuid,
  agentInstanceId: uuid,
  kind: Schema.Literals(["preference", "episode_history", "working_note"]),
  status: Schema.Literals(["proposed", "active", "rejected", "deleted"]),
  version: Schema.Int,
  content: Schema.Unknown,
  expiresAt: Schema.NullOr(instant),
  createdAt: instant,
  updatedAt: instant,
})
const event = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: uuid,
  sequence: Schema.Natural,
  type: Schema.String,
  occurredAt: instant,
  payload: Schema.Unknown,
})

export const AgentAuditRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("ListInstances") }),
  Schema.Struct({ operation: Schema.Literal("GetRun"), runId: uuid }),
  Schema.Struct({
    operation: Schema.Literal("ReplayEvents"),
    runId: uuid,
    afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
    limit: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal("ListMemories"),
    agentInstanceId: uuid,
  }),
  Schema.Struct({
    operation: Schema.Literal("CreateMemory"),
    agentInstanceId: uuid,
    kind: Schema.Literals(["preference", "working_note"]),
    content: Schema.Unknown,
    expiresAt: Schema.optional(instant),
  }),
  Schema.Struct({
    operation: Schema.Literal("ApproveMemory"),
    agentInstanceId: uuid,
    memoryId: uuid,
  }),
  Schema.Struct({
    operation: Schema.Literal("DeleteMemory"),
    agentInstanceId: uuid,
    memoryId: uuid,
  }),
])
export const AgentAuditReplySchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Instances"),
    instances: Schema.Array(instance),
  }),
  Schema.Struct({ _tag: Schema.Literal("Run"), run }),
  Schema.Struct({
    _tag: Schema.Literal("Events"),
    events: Schema.Array(event).check(Schema.isMaxLength(100)),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Memories"),
    memories: Schema.Array(memory),
  }),
  Schema.Struct({ _tag: Schema.Literal("Memory"), memory }),
  Schema.Struct({ _tag: Schema.Literal("Deleted") }),
  Schema.Struct({ _tag: Schema.Literal("NotFound") }),
  Schema.Struct({ _tag: Schema.Literal("Conflict") }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
    ]),
  }),
])
export const parseAgentAuditRequest = parse(AgentAuditRequestSchema)
export const parseAgentAuditReply = parse(AgentAuditReplySchema)
