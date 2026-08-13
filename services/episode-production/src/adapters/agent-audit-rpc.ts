import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  AgentAuditReplySchema,
  MessageEnvelopeSchema,
  parseAgentAuditRequest,
  parseMessageEnvelope,
  subjects,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  decideAgentMemory,
  getOwnedAgentRun,
  listAgentInstances,
  listAgentMemories,
  proposeAgentMemory,
  replayAgentAuditEvents,
  softDeleteAgentMemory,
  type AgentAuditMemoryRepository,
} from "../application/agent-audit-memory.js"
import type { AgentMemoryId } from "../domain/agent-audit-memory.js"
import type { UtcTimestamp } from "../domain/episode-job.js"

export type AgentAuditRpcDelivery<E = never> = Readonly<{
  payload: string
  reply: (payload: string) => Effect.Effect<void, E>
}>
export type AgentAuditRpcDependencies = Readonly<{
  newMessageId: () => string
  nextMemoryId: Effect.Effect<AgentMemoryId>
  now: Effect.Effect<UtcTimestamp>
  nowString: () => string
}>

const rejected = (
  code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "STORAGE_FAILURE"
) => deepFreeze({ _tag: "Rejected" as const, code })
const publicInstance = ({
  ownerId: _,
  ...value
}: { ownerId: unknown } & Record<string, unknown>) => value
const publicRun = ({
  ownerId: _,
  ...value
}: { ownerId: unknown } & Record<string, unknown>) => value
const publicMemory = ({
  ownerId: _,
  ...value
}: { ownerId: unknown } & Record<string, unknown>) => value

export const makeAgentAuditRpcHandler =
  (
    repository: AgentAuditMemoryRepository,
    dependencies: AgentAuditRpcDependencies
  ) =>
  <E>(delivery: AgentAuditRpcDelivery<E>) => {
    const send = (request: MessageEnvelope, payload: unknown) =>
      parse(AgentAuditReplySchema)(payload).pipe(
        Effect.flatMap((trusted) =>
          Effect.currentSpan.pipe(
            Effect.flatMap((span) =>
              parse(MessageEnvelopeSchema)({
                messageId: dependencies.newMessageId(),
                correlationId: request.correlationId,
                causationId: request.messageId,
                occurredAt: dependencies.nowString(),
                producer: "episode-production",
                traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
                actor: { _tag: "Service", service: "episode-production" },
                payload: trusted,
              })
            )
          )
        ),
        Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
        Effect.map(JSON.stringify),
        Effect.flatMap(delivery.reply)
      )

    return Effect.try({
      try: () => JSON.parse(delivery.payload) as unknown,
      catch: () => undefined,
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () =>
          delivery.reply(JSON.stringify(rejected("INVALID_REQUEST"))),
        onSuccess: (request) => {
          const reply = (payload: unknown) => send(request, payload)
          const ownerId =
            request.actor._tag === "User" ? request.actor.userId : undefined
          const process =
            request.producer !== "gateway"
              ? reply(rejected("INVALID_REQUEST"))
              : ownerId === undefined
                ? reply(rejected("UNAUTHENTICATED"))
                : parseAgentAuditRequest(request.payload).pipe(
                    Effect.flatMap(
                      (command): Effect.Effect<unknown, unknown> => {
                        switch (command.operation) {
                          case "ListInstances":
                            return listAgentInstances(repository, ownerId).pipe(
                              Effect.map((instances) => ({
                                _tag: "Instances",
                                instances: instances.map(publicInstance),
                              }))
                            )
                          case "GetRun":
                            return getOwnedAgentRun(repository, {
                              ownerId,
                              runId: command.runId,
                            }).pipe(
                              Effect.map((run) =>
                                run === undefined
                                  ? { _tag: "NotFound" }
                                  : { _tag: "Run", run: publicRun(run) }
                              )
                            )
                          case "ReplayEvents":
                            return replayAgentAuditEvents(repository, {
                              ownerId,
                              runId: command.runId,
                              afterSequence: Math.max(
                                -1,
                                command.afterSequence
                              ),
                              limit: Math.min(100, Math.max(1, command.limit)),
                            }).pipe(
                              Effect.map((events) =>
                                events === undefined
                                  ? { _tag: "NotFound" }
                                  : { _tag: "Events", events }
                              )
                            )
                          case "ListMemories":
                            return listAgentMemories(repository, {
                              ownerId,
                              agentInstanceId: command.agentInstanceId,
                            }).pipe(
                              Effect.map((result) =>
                                result._tag === "NotFound"
                                  ? result
                                  : {
                                      _tag: "Memories",
                                      memories:
                                        result.memories.map(publicMemory),
                                    }
                              )
                            )
                          case "CreateMemory":
                            return proposeAgentMemory(
                              {
                                ...repository,
                                nextMemoryId: dependencies.nextMemoryId,
                                now: dependencies.now,
                              },
                              { ownerId, ...command }
                            ).pipe(
                              Effect.map((memory) =>
                                memory === undefined
                                  ? { _tag: "NotFound" }
                                  : {
                                      _tag: "Memory",
                                      memory: publicMemory(memory),
                                    }
                              )
                            )
                          case "ApproveMemory":
                            return decideAgentMemory(
                              { ...repository, now: dependencies.now },
                              { ownerId, ...command, decision: "approve" }
                            ).pipe(
                              Effect.map((result) =>
                                result._tag === "Updated"
                                  ? {
                                      _tag: "Memory",
                                      memory: publicMemory(result.memory),
                                    }
                                  : result._tag === "StateConflict"
                                    ? { _tag: "Conflict" }
                                    : result
                              )
                            )
                          case "DeleteMemory":
                            return softDeleteAgentMemory(
                              { ...repository, now: dependencies.now },
                              { ownerId, ...command }
                            ).pipe(
                              Effect.map((result) =>
                                result._tag === "StateConflict"
                                  ? { _tag: "Conflict" }
                                  : result
                              )
                            )
                        }
                      }
                    ),
                    Effect.matchEffect({
                      onFailure: (failure) =>
                        reply(
                          rejected(
                            typeof failure === "object" &&
                              failure !== null &&
                              "_tag" in failure &&
                              failure._tag === "AgentAuditMemoryStoreFailed"
                              ? "STORAGE_FAILURE"
                              : "INVALID_REQUEST"
                          )
                        ),
                      onSuccess: reply,
                    })
                  )
          return withRemoteTraceparent(
            withMessagingSpan(
              process,
              subjects.production.agentAuditMemory,
              "process"
            ),
            request.traceparent
          )
        },
      })
    )
  }
