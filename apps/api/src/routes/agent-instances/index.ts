// 所有者ごとの永続Agentインスタンスと、その提案/承認/削除ワークフローを持つMemory。
import type { RouteRegistrar } from "../../http/context.js"
import { registerApproveAgentMemory } from "./approve-memory.js"
import { registerCreateAgentMemory } from "./create-memory.js"
import { registerDeleteAgentMemory } from "./delete-memory.js"
import { registerListAgentInstances } from "./list.js"
import { registerListAgentMemories } from "./list-memories.js"

export const agentInstancesRegistrars: readonly RouteRegistrar[] = [
  registerListAgentInstances,
  registerListAgentMemories,
  registerCreateAgentMemory,
  registerApproveAgentMemory,
  registerDeleteAgentMemory,
]
