import type { JobId, UtcTimestamp } from "../domain/episode-job.js"

export type JobCancellationListener = (canceledAt: UtcTimestamp) => void

/** Process-local fast path. Durable SQLite fencing remains the source of truth. */
export const makeJobCancellationRegistry = () => {
  const listeners = new Map<JobId, JobCancellationListener>()

  return {
    subscribe: (jobId: JobId, listener: JobCancellationListener) => {
      listeners.set(jobId, listener)
      return () => {
        if (listeners.get(jobId) === listener) listeners.delete(jobId)
      }
    },
    notify: (jobId: JobId, canceledAt: UtcTimestamp): boolean => {
      const listener = listeners.get(jobId)
      if (listener === undefined) return false
      listener(canceledAt)
      return true
    },
  }
}

export type JobCancellationRegistry = ReturnType<
  typeof makeJobCancellationRegistry
>
