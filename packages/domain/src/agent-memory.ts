export const AGENT_MEMORY_KINDS = [
  "preference",
  "episode_history",
  "working_note",
] as const

export type AgentMemoryKind = (typeof AGENT_MEMORY_KINDS)[number]

export const AGENT_MEMORY_STATUSES = [
  "proposed",
  "active",
  "rejected",
  "deleted",
] as const

export type AgentMemoryStatus = (typeof AGENT_MEMORY_STATUSES)[number]

export function initialMemoryStatus(kind: AgentMemoryKind): AgentMemoryStatus {
  return kind === "episode_history" ? "active" : "proposed"
}

export function canAgentAutoActivateMemory(kind: AgentMemoryKind): boolean {
  return kind === "episode_history"
}
