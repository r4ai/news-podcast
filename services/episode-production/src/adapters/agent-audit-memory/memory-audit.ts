import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { AgentAuditMemoryRepository } from "../../application/agent-audit-memory.js"
import { decideAgentMemoryStatus } from "../../domain/agent-audit-memory.js"
import type { UnsafeAgentAuditMemoryHandle } from "../../infrastructure/unsafe/sqlite-agent-audit-memory.js"
import {
  decodeMemory,
  encodeTimestamp,
  failure,
  toMemoryRow,
} from "./codecs.js"

/**
 * エージェント記憶の申請と承認・却下・削除。
 * 記憶は消さずに状態だけを進めるので、監査の履歴が途切れない。
 */

type MemoryAudit = Pick<
  AgentAuditMemoryRepository,
  | "proposeMemory"
  | "listOwnedMemories"
  | "decideOwnedMemory"
  | "softDeleteOwnedMemory"
>

export const makeMemoryAudit = (
  handle: UnsafeAgentAuditMemoryHandle
): MemoryAudit => {
  const proposeMemory: AgentAuditMemoryRepository["proposeMemory"] = (memory) =>
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
        try: () =>
          handle.decideOwnedMemory({
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
    proposeMemory,
    listOwnedMemories,
    decideOwnedMemory,
    softDeleteOwnedMemory,
  })
}
