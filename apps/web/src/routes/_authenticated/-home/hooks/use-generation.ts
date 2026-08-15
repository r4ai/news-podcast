import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useEffect, useState, useTransition } from "react"

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
  failureRecovery,
  hasActiveJob,
  resolvedJobStatus,
  stageLabel,
  stagePercent,
  type JobStatus,
  type JobStage,
} from "../model"
import { settleJobAction } from "./job-action"
import { useGenerationStream } from "./use-generation-stream"

const jobsQueryOptions = api.queryOptions("get", "/v1/episode-jobs")

export function useGeneration() {
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitialArticleIds, setPickerInitialArticleIds] = useState<
    readonly string[]
  >([])
  const [submitError, setSubmitError] = useState<string>()
  const [streamConnected, setStreamConnected] = useState(false)
  const jobs = api.useSuspenseQuery("get", "/v1/episode-jobs", undefined, {
    // 進行中のジョブがある間だけ追従し、静止したら止める。SSEが生きている
    // 間はそちらが最新なので、ポーリングはフォールバックとして眠らせる。
    refetchInterval: (query) =>
      !streamConnected &&
      query.state.data &&
      hasActiveJob(query.state.data.items)
        ? 1_000
        : false,
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

  // 進行中かどうかで絞らず、常に最新ジョブを購読する。終端済みのジョブでも
  // サーバは履歴を全部リプレイして閉じるので、完成後もエージェントが何を
  // したかが残る。進行中だけを購読すると、完了と同時に作業ログが消える。
  const stream = useGenerationStream(latestJob?.id)

  useEffect(() => {
    setStreamConnected(stream.connected)
  }, [stream.connected])

  // ストリームが終端に達したら、ジョブとエピソードの両方を取り直す。
  // ポーリング中は latestJob.status の変化が同じ役割を果たす。
  useEffect(() => {
    if (!stream.finished) return
    void queryClient.invalidateQueries({ queryKey: jobsQueryOptions.queryKey })
    void queryClient.invalidateQueries({
      queryKey: episodesQueryOptions.queryKey,
    })
  }, [stream.finished, queryClient])

  // SSEのretrying eventには次回時刻がある一方、画面の正本はjobs API。
  // 一度だけ再取得して、接続中でも再試行予定時刻とattemptを同期する。
  useEffect(() => {
    if (stream.state?.status !== "retrying") return
    void queryClient.invalidateQueries({ queryKey: jobsQueryOptions.queryKey })
  }, [stream.state?.status, queryClient])

  useEffect(() => {
    if (latestJob?.status === "succeeded") {
      void queryClient.invalidateQueries({
        queryKey: episodesQueryOptions.queryKey,
      })
    }
  }, [latestJob?.status, queryClient])

  // SSEが繋がっている間はそちらが最新。切れていればポーリング結果を使う。
  const liveState =
    stream.connected || stream.finished ? stream.state : undefined
  const state = resolvedJobStatus(
    liveState?.status as JobStatus | undefined,
    latestJob?.status
  )
  const stage = (liveState?.stage ?? latestJob?.stage) as JobStage | undefined
  const stageProgress = liveState?.progress ?? latestJob?.stageProgress
  const failure = liveState?.failure ?? latestJob?.failure ?? undefined
  const recovery = failureRecovery(failure?.code)

  function runJobAction(
    request: () => Promise<unknown>,
    fallbackMessage: string
  ) {
    startTransition(async () => {
      const error = await settleJobAction(request, () =>
        queryClient.invalidateQueries({
          queryKey: jobsQueryOptions.queryKey,
        })
      )
      if (error !== undefined) {
        setSubmitError(messageFromActionError(error, fallbackMessage))
      }
    })
  }

  function generate(articleIds: readonly string[]) {
    startTransition(async () => {
      try {
        await createJob.mutateAsync({
          params: { header: { "idempotency-key": crypto.randomUUID() } },
          body: { trigger: "manual", articleIds: [...articleIds] },
        })
        recordBrowserEvent("episode.requested", { result: "succeeded" })
        setPickerOpen(false)
        await queryClient.invalidateQueries({
          queryKey: jobsQueryOptions.queryKey,
        })
      } catch (error) {
        recordBrowserEvent("episode.requested", { result: "failed" })
        setSubmitError(messageFromSubmitError(error))
      }
    })
  }

  return {
    attempt: latestJob?.attempt,
    maxAttempts: latestJob?.maxAttempts,
    deadlineAt: latestJob?.deadlineAt ?? undefined,
    lastProgressAt: latestJob?.lastProgressAt ?? undefined,
    retryAt: latestJob?.nextAttemptAt ?? undefined,
    stageProgress: stageProgress ?? undefined,
    failure: failureMessage(failure),
    retryLabel:
      recovery === "reselect"
        ? "記事を選び直して再生成"
        : recovery === "retry"
          ? "同じ条件で再試行"
          : recovery === "admin"
            ? "新規生成"
            : "新規生成",
    progress: state === "running" && stage ? stagePercent(stage) : undefined,
    stage: state === "running" && stage ? stageLabel(stage) : undefined,
    state,
    timeline: stream.timeline,
    adoptedArticles: stream.adoptedArticles,
    streaming: stream.connected,
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
    pickerOpen,
    pickerInitialArticleIds,
    // 生成は記事選択が前提なので、ボタンは即発火ではなくダイアログを開く。
    onGenerate: () => {
      setSubmitError(undefined)
      setPickerInitialArticleIds([])
      setPickerOpen(true)
    },
    onPickerOpenChange: setPickerOpen,
    onConfirmGenerate: generate,
    onCancel: () =>
      latestJob &&
      runJobAction(
        () =>
          cancelJob.mutateAsync({
            params: { path: { jobId: latestJob.id } },
          }),
        "生成をキャンセルできませんでした。状態を更新してからもう一度お試しください。"
      ),
    onRetry: () => {
      setSubmitError(undefined)
      if (recovery === "reselect") {
        setPickerInitialArticleIds(latestJob?.articleIds ?? [])
        setPickerOpen(true)
        return
      }
      if (recovery === "retry" && latestJob) {
        runJobAction(
          () =>
            retryJob.mutateAsync({
              params: { path: { jobId: latestJob.id } },
            }),
          "同じ条件で再試行できませんでした。状態を更新してからもう一度お試しください。"
        )
        return
      }
      setPickerInitialArticleIds([])
      setPickerOpen(true)
    },
    submitError,
    onDismissSubmitError: () => setSubmitError(undefined),
  } as const
}

function messageFromActionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
}

function messageFromSubmitError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Record<string, unknown>).code === "unselectable-articles"
  ) {
    return "選択した記事の一部が現在は利用できません。一覧に表示されている記事だけを選び直してください。"
  }
  if (error instanceof Error) return error.message
  return "生成を開始できませんでした。もう一度お試しください。"
}
