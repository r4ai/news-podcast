// Agent実行の安全なタイムライン（推論本文を含まない）。
import type { RouteRegistrar } from "../../http/context.js"
import { registerListAgentEvents } from "./events.js"
import { registerGetAgentRun } from "./get.js"

export const agentRunsRegistrars: readonly RouteRegistrar[] = [
  registerGetAgentRun,
  registerListAgentEvents,
]
