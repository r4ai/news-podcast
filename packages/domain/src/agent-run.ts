export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "retrying",
  "succeeded",
  "failed",
  "canceled",
] as const

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

const allowedTargets: Readonly<
  Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>
> = {
  queued: new Set(["running", "canceled"]),
  running: new Set([
    "waiting_approval",
    "retrying",
    "succeeded",
    "failed",
    "canceled",
  ]),
  waiting_approval: new Set(["queued", "failed", "canceled"]),
  retrying: new Set(["running", "canceled"]),
  succeeded: new Set(),
  failed: new Set(),
  canceled: new Set(),
}

export class InvalidAgentRunTransitionError extends Error {
  constructor(from: AgentRunStatus, to: AgentRunStatus) {
    super(`Agent run cannot transition from ${from} to ${to}`)
    this.name = "InvalidAgentRunTransitionError"
  }
}

export function transitionAgentRun(
  from: AgentRunStatus,
  to: AgentRunStatus
): AgentRunStatus {
  if (!allowedTargets[from].has(to)) {
    throw new InvalidAgentRunTransitionError(from, to)
  }
  return to
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return allowedTargets[status].size === 0
}

