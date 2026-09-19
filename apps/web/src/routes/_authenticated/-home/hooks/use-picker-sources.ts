import { useQuery } from "@tanstack/react-query"

import {
  feedSyncJobsQueryOptions,
  subscriptionsQueryOptions,
  isFeedSyncActive,
  type FeedSyncJob,
} from "@/features/subscriptions"

export type PickerSourceState =
  | "checking"
  | "source-error"
  | "no-subscriptions"
  | "paused"
  | "syncing"
  | "sync-failed"
  | "empty"

/** Empty-state metadata shares the settings cache without suspending generation. */
export function usePickerSources(enabled: boolean) {
  const subscriptions = useQuery({ ...subscriptionsQueryOptions, enabled })
  const activeFeeds = new Set(
    subscriptions.data?.items
      .filter((item) => item.enabled)
      .map((item) => item.feedId)
  )
  const jobs = useQuery({
    ...feedSyncJobsQueryOptions,
    enabled: enabled && activeFeeds.size > 0,
  })

  function sourceState(): PickerSourceState {
    if (subscriptions.isError) return "source-error"
    if (!subscriptions.data) return "checking"
    if (subscriptions.data.items.length === 0) return "no-subscriptions"
    if (activeFeeds.size === 0) return "paused"
    if (jobs.isError) return "source-error"
    if (!jobs.data) return "checking"
    const latest = new Map<string, FeedSyncJob>()
    for (const job of jobs.data.items) {
      if (!activeFeeds.has(job.feedId)) continue
      const previous = latest.get(job.feedId)
      if (!previous || previous.createdAt < job.createdAt)
        latest.set(job.feedId, job)
    }
    const current = [...latest.values()]
    if (current.some(isFeedSyncActive)) return "syncing"
    if (current.some((job) => job.status === "failed" || job.failed > 0))
      return "sync-failed"
    return "empty"
  }

  return {
    state: sourceState(),
    isFetching: subscriptions.isFetching || jobs.isFetching,
    onRetry: () => {
      void subscriptions.refetch()
      if (activeFeeds.size > 0) void jobs.refetch()
    },
  }
}
