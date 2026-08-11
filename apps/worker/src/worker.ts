import type {
  EpisodeJobMessage,
  JobLeaseStore,
} from "@news-podcast/application"

export interface EpisodeJobProcessor {
  process(message: EpisodeJobMessage): Promise<void>
}

export function createPollingWorker(
  leases: JobLeaseStore,
  processor: EpisodeJobProcessor
) {
  return {
    async runOnce(now = new Date()): Promise<"idle" | "processed"> {
      const job = await leases.leaseNext(now, 60)
      if (!job) {
        return "idle"
      }

      await processor.process({
        ownerId: job.ownerId,
        jobId: job.jobId,
        ...(job.traceContext ? { traceContext: job.traceContext } : {}),
      })
      return "processed"
    },
  }
}
