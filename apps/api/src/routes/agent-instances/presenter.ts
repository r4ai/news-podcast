import type { AgentMemoryRecord } from "@news-podcast/application"

export function toAgentMemoryResponse(memory: AgentMemoryRecord) {
  return {
    id: memory.id,
    agentInstanceId: memory.agentInstanceId,
    kind: memory.kind,
    status: memory.status,
    version: memory.version,
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    ...(memory.expiresAt ? { expiresAt: memory.expiresAt.toISOString() } : {}),
  }
}
