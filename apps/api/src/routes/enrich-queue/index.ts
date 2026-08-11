// AI補助（要約+関連度スコア）の処理キュー状態・SSE配信・再処理操作。
import type { RouteRegistrar } from "../../http/context.js"
import { registerEnrichQueueEvents } from "./events.js"
import { registerEnrichReprocess } from "./reprocess.js"
import { registerEnrichResetDaily } from "./reset-daily.js"
import { registerEnrichQueueStatus } from "./status.js"

export const enrichQueueRegistrars: readonly RouteRegistrar[] = [
  registerEnrichQueueStatus,
  registerEnrichQueueEvents,
  registerEnrichReprocess,
  registerEnrichResetDaily,
]

export {
  registerEnrichQueueStatus,
  registerEnrichQueueEvents,
  registerEnrichReprocess,
  registerEnrichResetDaily,
}
