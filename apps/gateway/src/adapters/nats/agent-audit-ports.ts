import { parse } from "@news-podcast/kernel"
import { parseAgentAuditReply, subjects } from "@news-podcast/protocols"
import { Effect, type Schema } from "effect"

import {
  AgentInstancePageSchema,
  AgentMemoryPageSchema,
  AgentMemorySchema,
  AgentRunEventSchema,
  AgentRunSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import { conflict, notFound, unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * エージェント実行の監査と、エージェント記憶の申請・承認・削除。
 * 「無い」「競合した」は問題詳細のまま保ち、それ以外だけを503へ畳む。
 */

type TypeOf<S extends Schema.Top> = Schema.Schema.Type<S>
type Unavailable = ReturnType<typeof unavailable>
type Missing = ReturnType<typeof notFound>
type Conflicted = ReturnType<typeof conflict>
type Replied<Value> = Effect.Effect<Value, Unavailable>
type Findable<Value> = Effect.Effect<Value, Unavailable | Missing>
type Mutable<Value> = Effect.Effect<Value, Unavailable | Missing | Conflicted>

type AgentAuditPorts = Pick<
  GatewayPorts,
  | "listAgentInstances"
  | "getAgentRun"
  | "replayAgentRunEvents"
  | "listAgentMemories"
  | "createAgentMemory"
  | "approveAgentMemory"
  | "deleteAgentMemory"
>

export const makeAgentAuditPorts = (transport: Transport): AgentAuditPorts => {
  const auditRpc = (
    headers: Parameters<GatewayPorts["listAgentInstances"]>[0],
    payload: unknown
  ) =>
    transport.ownerRpc(
      headers,
      subjects.production.agentAuditMemory,
      "episode-production",
      payload,
      parseAgentAuditReply
    )

  return {
    listAgentInstances: (headers) =>
      auditRpc(headers, { operation: "ListInstances" }).pipe(
        Effect.flatMap(
          (reply): Replied<TypeOf<typeof AgentInstancePageSchema>> =>
            reply._tag === "Instances"
              ? parse(AgentInstancePageSchema)({ items: reply.instances }).pipe(
                  Effect.mapError(unavailable)
                )
              : Effect.fail(unavailable())
        )
      ),
    getAgentRun: ({ headers, runId }) =>
      auditRpc(headers, { operation: "GetRun", runId }).pipe(
        Effect.flatMap((reply): Findable<TypeOf<typeof AgentRunSchema>> =>
          reply._tag === "Run"
            ? parse(AgentRunSchema)(reply.run).pipe(
                Effect.mapError(unavailable)
              )
            : reply._tag === "NotFound"
              ? Effect.fail(notFound())
              : Effect.fail(unavailable())
        )
      ),
    replayAgentRunEvents: ({ headers, runId, afterSequence }) =>
      auditRpc(headers, {
        operation: "ReplayEvents",
        runId,
        afterSequence,
        limit: 100,
      }).pipe(
        Effect.flatMap(
          (reply): Findable<readonly TypeOf<typeof AgentRunEventSchema>[]> =>
            reply._tag === "Events"
              ? Effect.forEach(reply.events, (event) =>
                  parse(AgentRunEventSchema)(event).pipe(
                    Effect.mapError(unavailable)
                  )
                )
              : reply._tag === "NotFound"
                ? Effect.fail(notFound())
                : Effect.fail(unavailable())
        )
      ),
    listAgentMemories: ({ headers, agentInstanceId }) =>
      auditRpc(headers, { operation: "ListMemories", agentInstanceId }).pipe(
        Effect.flatMap(
          (reply): Findable<TypeOf<typeof AgentMemoryPageSchema>> =>
            reply._tag === "Memories"
              ? parse(AgentMemoryPageSchema)({ items: reply.memories }).pipe(
                  Effect.mapError(unavailable)
                )
              : reply._tag === "NotFound"
                ? Effect.fail(notFound())
                : Effect.fail(unavailable())
        )
      ),
    createAgentMemory: ({ headers, agentInstanceId, payload }) =>
      auditRpc(headers, {
        operation: "CreateMemory",
        agentInstanceId,
        ...payload,
      }).pipe(
        Effect.flatMap((reply): Findable<TypeOf<typeof AgentMemorySchema>> =>
          reply._tag === "Memory"
            ? parse(AgentMemorySchema)(reply.memory).pipe(
                Effect.mapError(unavailable)
              )
            : reply._tag === "NotFound"
              ? Effect.fail(notFound())
              : Effect.fail(unavailable())
        )
      ),
    approveAgentMemory: ({ headers, agentInstanceId, memoryId }) =>
      auditRpc(headers, {
        operation: "ApproveMemory",
        agentInstanceId,
        memoryId,
      }).pipe(
        Effect.flatMap((reply): Mutable<TypeOf<typeof AgentMemorySchema>> =>
          reply._tag === "Memory"
            ? parse(AgentMemorySchema)(reply.memory).pipe(
                Effect.mapError(unavailable)
              )
            : reply._tag === "NotFound"
              ? Effect.fail(notFound())
              : reply._tag === "Conflict"
                ? Effect.fail(conflict())
                : Effect.fail(unavailable())
        )
      ),
    deleteAgentMemory: ({ headers, agentInstanceId, memoryId }) =>
      auditRpc(headers, {
        operation: "DeleteMemory",
        agentInstanceId,
        memoryId,
      }).pipe(
        Effect.flatMap((reply): Mutable<void> =>
          reply._tag === "Deleted"
            ? Effect.void
            : reply._tag === "NotFound"
              ? Effect.fail(notFound())
              : reply._tag === "Conflict"
                ? Effect.fail(conflict())
                : Effect.fail(unavailable())
        )
      ),
  }
}
