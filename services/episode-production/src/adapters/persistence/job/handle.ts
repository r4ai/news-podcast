import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeJobOutboxHandle } from "./outbox-handle.js"
import { makeJobPlanHandle } from "./plan-handle.js"
import type { SqliteJobHandle } from "./ports.js"
import { makeJobProgressHandle } from "./progress-handle.js"
import { makeJobReadHandle } from "./read-handle.js"

/**
 * Application-facing compatibility facade.
 * Each component receives the same process-owned database explicitly.
 */
export const makeJobHandle = (
  database: ProductionDatabase
): SqliteJobHandle => ({
  ...makeJobReadHandle(database),
  ...makeJobProgressHandle(database),
  ...makeJobPlanHandle(database),
  ...makeJobOutboxHandle(database),
  close: () => {
    // 接続はサービスプロセスが所有する。ハンドルは閉じない。
  },
})

export { ACTIVE_STATUSES } from "./shared.js"
export type { SqliteJobHandle } from "./ports.js"
