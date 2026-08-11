import type { JobDto } from "@news-podcast/adapters/db/local"
import type { EpisodeJobState } from "@news-podcast/contracts/agui"

/** ジョブの現在状態からAG-UIのSTATE_SNAPSHOTペイロードを組み立てる。 */
export function toJobStateSnapshot(job: JobDto): EpisodeJobState {
  return {
    jobId: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    // 履歴は後続のイベント再生で積み上がるので、ここでは空から始める。
    adoptedArticles: [],
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.stageProgress ? { progress: job.stageProgress } : {}),
    ...(job.failure
      ? { failure: { code: job.failure.code, message: job.failure.message } }
      : {}),
    ...(job.episodeId ? { episodeId: job.episodeId } : {}),
  }
}
