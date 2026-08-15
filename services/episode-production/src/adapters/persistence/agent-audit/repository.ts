import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  AgentAuditMemoryRepository,
  AgentAuditMemoryStoreError,
} from "../../../application/agent-audit-memory.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeAgentAuditMemoryHandle } from "./handle.js"
import type { UnsafeAgentAuditMemoryHandle } from "./ports.js"
import { failure } from "./codecs.js"
import { makeMemoryAudit } from "./memory-audit.js"
import { makeRunAudit } from "./run-audit.js"

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

export const agentAuditMemoryRepository = (
  database: ProductionDatabase
): Effect.Effect<
  SqliteAgentAuditMemoryRepository,
  AgentAuditMemoryStoreError
> =>
  Effect.try({
    try: () => repositoryFromHandle(makeAgentAuditMemoryHandle(database)),
    catch: () => failure("Open"),
  })
