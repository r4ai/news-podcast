import { useEffect, useTransition } from "react"

import { api } from "@/api/client"
import { queryClient } from "@/app/query-client"
import { PodcastDashboard } from "@/features/dashboard/podcast-dashboard"
import { failureMessage, stageLabel } from "./model"
import { recordBrowserEvent } from "@/observability/events"

const active = new Set(["queued", "running", "retrying"])
const stageProgress = {
  researching_sources: 35,
  fetching_sources: 20,
  generating_script: 45,
  synthesizing_audio: 75,
  storing_episode: 90,
} as const

export function GenerationPage() {
  const [pending, startTransition] = useTransition()
  const jobs = api.useSuspenseQuery("get", "/v1/episode-jobs", undefined, {
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.items.some((job) => active.has(job.status)) ? 1_000 : false
    },
  })
  const episodes = api.useSuspenseQuery("get", "/v1/episodes")
  const settings = api.useSuspenseQuery("get", "/v1/me/settings")
  const subscriptions = api.useSuspenseQuery("get", "/v1/me/feed-subscriptions")
  const feeds = api.useSuspenseQuery("get", "/v1/feeds", {
    params: { query: {} },
  })
  const createJob = api.useMutation("post", "/v1/episode-jobs")
  const cancelJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/cancel")
  const retryJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/retry")
  const latestJob = jobs.data.items[0]
  const latestEpisode = episodes.data.items[0]
  const feedById = new Map(feeds.data.items.map((feed) => [feed.id, feed]))

  useEffect(() => {
    if (latestJob?.status === "succeeded") {
      void queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/episodes").queryKey,
      })
    }
  }, [latestJob?.status])

  function generate() {
    startTransition(async () => {
      try {
        await createJob.mutateAsync({
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
          body: { trigger: "manual" },
        })
        recordBrowserEvent("episode.requested", { result: "succeeded" })
        await queryClient.invalidateQueries({
          queryKey: api.queryOptions("get", "/v1/episode-jobs").queryKey,
        })
      } catch (error) {
        recordBrowserEvent("episode.requested", { result: "failed" })
        throw error
      }
    })
  }

  function cancel() {
    if (!latestJob) return
    startTransition(async () => {
      await cancelJob.mutateAsync({
        params: { path: { jobId: latestJob.id } },
      })
      await queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/episode-jobs").queryKey,
      })
    })
  }

  function retry() {
    if (!latestJob) return
    startTransition(async () => {
      await retryJob.mutateAsync({
        params: { path: { jobId: latestJob.id } },
      })
      await queryClient.invalidateQueries({
        queryKey: api.queryOptions("get", "/v1/episode-jobs").queryKey,
      })
    })
  }

  return (
    <PodcastDashboard
      attempt={latestJob?.attempt}
      maxAttempts={latestJob?.maxAttempts}
      deadlineAt={latestJob?.deadlineAt}
      episode={
        latestEpisode
          ? {
              title: latestEpisode.title,
              createdAt: latestEpisode.createdAt,
              sourceCount: latestEpisode.sources.length,
            }
          : undefined
      }
      failure={failureMessage(latestJob?.failure)}
      onGenerate={generate}
      onCancel={cancel}
      onRetry={retry}
      pending={pending}
      progress={latestJob?.stage ? stageProgress[latestJob.stage] : undefined}
      retryAt={latestJob?.nextAttemptAt}
      lastProgressAt={latestJob?.lastProgressAt}
      stageProgress={latestJob?.stageProgress}
      schedule={settings.data.generationSchedule}
      stage={latestJob?.stage ? stageLabel(latestJob.stage) : undefined}
      state={latestJob?.status ?? "ready"}
      subscriptionNames={subscriptions.data.items
        .filter((subscription) => subscription.enabled)
        .map(
          (subscription) =>
            feedById.get(subscription.feedId)?.name ?? subscription.feedId
        )}
    />
  )
}
