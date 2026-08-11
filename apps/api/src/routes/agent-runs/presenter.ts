import type { AgentRunRecord } from "@news-podcast/application"

export function toAgentRunResponse(run: AgentRunRecord) {
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    policyHash: run.policyHash,
    createdAt: run.createdAt.toISOString(),
  }
}
