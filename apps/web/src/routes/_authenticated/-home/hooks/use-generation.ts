import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useEffect, useTransition } from "react"

import { episodesQueryOptions } from "@/features/episodes"
import { settingsQueryOptions } from "@/features/settings"
import {
  enabledFeedNames,
  feedsQueryOptions,
  subscriptionsQueryOptions,
  type Feed,
  type Subscription,
} from "@/features/subscriptions"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"
import {
  failureMessage,
  hasActiveJob,
  stageLabel,
  stagePercent,
} from "../model"

const jobsQueryOptions = api.queryOptions("get", "/v1/episode-jobs")

export function useGeneration() {
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const jobs = api.useSuspenseQuery("get", "/v1/episode-jobs", undefined, {
    // 進行中のジョブがある間だけ追従し、静止したら止める。
    refetchInterval: (query) =>
      query.state.data && hasActiveJob(query.state.data.items) ? 1_000 : false,
  })
  const { data: episodes } = useSuspenseQuery(episodesQueryOptions)
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  const { data: subscriptions } = useSuspenseQuery(subscriptionsQueryOptions)
  const { data: feeds } = useSuspenseQuery(feedsQueryOptions)
  const createJob = api.useMutation("post", "/v1/episode-jobs")
  const cancelJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/cancel")
  const retryJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/retry")

  const latestJob = jobs.data.items[0]
  const latestEpisode = episodes.items[0]

  useEffect(() => {
    if (latestJob?.status === "succeeded") {
      void queryClient.invalidateQueries({
        queryKey: episodesQueryOptions.queryKey,
      })
    }
  }, [latestJob?.status, queryClient])

  function runJobAction(request: () => Promise<unknown>) {
    startTransition(async () => {
      await request()
      await queryClient.invalidateQueries({
        queryKey: jobsQueryOptions.queryKey,
      })
    })
  }

  function generate() {
    startTransition(async () => {
      try {
        await createJob.mutateAsync({
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
          body: { trigger: "manual" },
        })
        recordBrowserEvent("episode.requested", { result: "succeeded" })
        await queryClient.invalidateQueries({
          queryKey: jobsQueryOptions.queryKey,
        })
      } catch (error) {
        recordBrowserEvent("episode.requested", { result: "failed" })
        throw error
      }
    })
  }

  return {
    attempt: latestJob?.attempt,
    maxAttempts: latestJob?.maxAttempts,
    deadlineAt: latestJob?.deadlineAt,
    lastProgressAt: latestJob?.lastProgressAt,
    retryAt: latestJob?.nextAttemptAt,
    stageProgress: latestJob?.stageProgress,
    failure: failureMessage(latestJob?.failure),
    progress: stagePercent(latestJob?.stage),
    stage: latestJob?.stage ? stageLabel(latestJob.stage) : undefined,
    state: latestJob?.status ?? ("ready" as const),
    schedule: settings.generationSchedule,
    subscriptionNames: enabledFeedNames(
      subscriptions.items as readonly Subscription[],
      feeds.items as readonly Feed[]
    ),
    episode: latestEpisode
      ? {
          title: latestEpisode.title,
          createdAt: latestEpisode.createdAt,
          sourceCount: latestEpisode.sources.length,
        }
      : undefined,
    pending,
    onGenerate: generate,
    onCancel: () =>
      latestJob &&
      runJobAction(() =>
        cancelJob.mutateAsync({ params: { path: { jobId: latestJob.id } } })
      ),
    onRetry: () =>
      latestJob &&
      runJobAction(() =>
        retryJob.mutateAsync({ params: { path: { jobId: latestJob.id } } })
      ),
  } as const
}
