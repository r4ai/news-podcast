import { deepFreeze } from "@news-podcast/kernel"
import { Effect, type Scope } from "effect"

import type {
  AgentAuditMemoryRepository,
  AgentAuditMemoryStoreError,
} from "../application/agent-audit-memory.js"
import {
  openUnsafeAgentAuditMemoryHandle,
  type UnsafeAgentAuditMemoryHandle,
} from "../infrastructure/unsafe/sqlite-agent-audit-memory.js"
import { failure } from "./agent-audit-memory/codecs.js"
import { makeMemoryAudit } from "./agent-audit-memory/memory-audit.js"
import { makeRunAudit } from "./agent-audit-memory/run-audit.js"

/**
 * エージェント監査ストアの合成点。実行の記録と記憶の管理を1つのリポジトリに束ね、
 * SQLiteハンドルの寿命をスコープに預ける。
 */

const repositoryFromHandle = (
  handle: UnsafeAgentAuditMemoryHandle
): AgentAuditMemoryRepository =>
  deepFreeze({
    ...makeRunAudit(handle),
    ...makeMemoryAudit(handle),
  } satisfies AgentAuditMemoryRepository)

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
