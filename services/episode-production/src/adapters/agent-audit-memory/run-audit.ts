import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { AgentAuditMemoryRepository } from "../../application/agent-audit-memory.js"
import {
  AgentRunStatusSchema,
  isTerminalAgentRunStatus,
} from "../../domain/agent-audit-memory.js"
import type { UnsafeAgentAuditMemoryHandle } from "../../infrastructure/unsafe/sqlite-agent-audit-memory.js"
import {
  decodeEvent,
  decodeInstance,
  decodeRun,
  encodeTimestamp,
  failure,
  sameRunCreation,
  toInstanceRow,
  toRunRow,
} from "./codecs.js"

/**
 * エージェント実行の記録：インスタンスの確保、実行の登録、
 * 状態遷移とイベント追記。同じ実行の再登録は冪等に扱う。
 */

type RunAudit = Pick<
  AgentAuditMemoryRepository,
  | "ensureInstance"
  | "listInstances"
  | "recordRun"
  | "getOwnedRun"
  | "replayOwnedEvents"
  | "appendOwnedEvent"
  | "transitionOwnedRun"
>

export const makeRunAudit = (
  handle: UnsafeAgentAuditMemoryHandle
): RunAudit => {
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
        row === undefined ? Effect.succeed(undefined) : decodeRun(row, "GetRun")
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
          : Effect.forEach(rows, (row) => decodeEvent(row, "ReplayEvents"), {
              concurrency: 1,
            }).pipe(Effect.map(deepFreeze))
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

  const transitionOwnedRun: AgentAuditMemoryRepository["transitionOwnedRun"] = (
    input
  ) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () =>
          handle.transitionOwnedRun({
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

  return deepFreeze({
    ensureInstance,
    listInstances,
    recordRun,
    getOwnedRun,
    replayOwnedEvents,
    appendOwnedEvent,
    transitionOwnedRun,
  })
}
