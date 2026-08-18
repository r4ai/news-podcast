import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useEffect, useState, useTransition } from "react"

import { episodeQueryOptions, episodesQueryOptions } from "@/features/episodes"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"
import {
  generationConnectedAtom,
  generationFinishedAtom,
  generationLiveEpisodeIdAtom,
  generationLiveFailureAtom,
  generationLiveStageAtom,
  generationLiveStatusAtom,
  generationStreamJobIdAtom,
} from "../atoms"
import {
  failureMessage,
  failureRecovery,
  hasActiveJob,
  resolvedJobStatus,
  stageLabel,
  stagePercent,
  type JobStatus,
} from "../model"
import { settleJobAction } from "./job-action"
import { useGenerationStream } from "./use-generation-stream"

const jobsQueryOptions = api.queryOptions("get", "/v1/episode-jobs")
const PROJECTION_RETRY_COUNT = 4
const PROJECTION_RETRY_DELAY_MS = 500

function shouldRetryProjection(failureCount: number, error: unknown): boolean {
  if (failureCount >= PROJECTION_RETRY_COUNT) return false
  if (error instanceof Error) return true
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false
  }
  const status = (error as { readonly status?: unknown }).status
  return status === 404 || status === 503
}

export function useGeneration() {
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitialArticleIds, setPickerInitialArticleIds] = useState<
    readonly string[]
  >([])
  const [submitError, setSubmitError] = useState<string>()
  // ストリームの状態は「実際に描くもの」だけを購読する。timelineと採用記事は
  // 進捗カードの中でしか描かれないので、ここでは読まない。読むと毎フレーム
  // ダッシュボード全体が描き直される (ADR-0060)。
  const streamJobId = useAtomValue(generationStreamJobIdAtom)
  const streamConnected = useAtomValue(generationConnectedAtom)
  const streamFinished = useAtomValue(generationFinishedAtom)
  const liveStatus = useAtomValue(generationLiveStatusAtom)
  const liveEpisodeId = useAtomValue(generationLiveEpisodeIdAtom)
  const liveStage = useAtomValue(generationLiveStageAtom)
  const liveFailure = useAtomValue(generationLiveFailureAtom)

  const jobs = api.useSuspenseQuery("get", "/v1/episode-jobs", undefined, {
    // 進行中のジョブがある間だけ追従し、静止したら止める。SSEが生きている
    // 間はそちらが最新なので、ポーリングはフォールバックとして眠らせる。
    //
    // 眠らせてよいのは「今の最新ジョブのストリームが繋がっている」時だけ。
    // 前のジョブのストリームで止めると、新しいジョブの進捗が誰も追わなくなる。
    refetchInterval: (query) => {
      const items = query.state.data?.items
      if (!items) return false
      const streamIsCurrent =
        items[0] !== undefined && streamJobId === items[0].id
      return !(streamIsCurrent && streamConnected) && hasActiveJob(items)
        ? 1_000
        : false
    },
  })
  const { data: episodes } = useSuspenseQuery(episodesQueryOptions)
  const createJob = api.useMutation("post", "/v1/episode-jobs")
  const cancelJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/cancel")
  const retryJob = api.useMutation("post", "/v1/episode-jobs/{jobId}/retry")

  const latestJob = jobs.data.items[0]

  // 進行中かどうかで絞らず、常に最新ジョブを購読する。終端済みのジョブでも
  // サーバは履歴を全部リプレイして閉じるので、完成後も生成処理が何を
  // したかが残る。進行中だけを購読すると、完了と同時に作業ログが消える。
  useGenerationStream(latestJob?.id)

  // ストリームが終端に達したら、ジョブとエピソードの両方を取り直す。
  // ポーリング中は latestJob.status の変化が同じ役割を果たす。
  useEffect(() => {
    if (!streamFinished) return
    void queryClient.invalidateQueries({ queryKey: jobsQueryOptions.queryKey })
    void queryClient.invalidateQueries({
      queryKey: episodesQueryOptions.queryKey,
    })
  }, [streamFinished, queryClient])

  // SSEのretrying eventには次回時刻がある一方、画面の正本はjobs API。
  // 一度だけ再取得して、接続中でも再試行予定時刻とattemptを同期する。
  useEffect(() => {
    if (liveStatus !== "retrying") return
    void queryClient.invalidateQueries({ queryKey: jobsQueryOptions.queryKey })
  }, [liveStatus, queryClient])

  // SSEが繋がっている間はそちらが最新。切れていればポーリング結果を使う。
  // ただし今のジョブのストリームである時だけ。購読の張り替えはEffectなので、
  // ジョブが変わった直後の1描画では前のジョブの値がまだatomに残っている。
  const liveForThisJob = latestJob !== undefined && streamJobId === latestJob.id
  const live = liveForThisJob && (streamConnected || streamFinished)
  const state = resolvedJobStatus(
    live ? (liveStatus as JobStatus | undefined) : undefined,
    latestJob?.status
  )
  const stage = (live ? liveStage : undefined) ?? latestJob?.stage
  const stageProgress = latestJob?.stageProgress
  const failure =
    (live ? liveFailure : undefined) ?? latestJob?.failure ?? undefined
  const recovery = failureRecovery(failure?.code)
  const projectionEpisodeId =
    state === "succeeded"
      ? ((live ? liveEpisodeId : undefined) ??
        latestJob?.episodeId ??
        undefined)
      : undefined
  const projection = useQuery({
    ...episodeQueryOptions(projectionEpisodeId ?? ""),
    enabled: projectionEpisodeId !== undefined,
    retry: shouldRetryProjection,
    retryDelay: PROJECTION_RETRY_DELAY_MS,
  })
  const presentationState =
    projectionEpisodeId === undefined
      ? state
      : projection.data
        ? "succeeded"
        : projection.isError
          ? "projection-failed"
          : "projecting"
  const latestEpisode = projection.data ?? episodes.items[0]

  // 対象Episodeが読めた時点で一覧も再取得する。詳細を画面へ即時表示しつつ、
  // HomeとLibraryが共有する一覧cacheを投影後の状態へ収束させる。
  useEffect(() => {
    if (!projection.data) return
    void queryClient.invalidateQueries({
      queryKey: episodesQueryOptions.queryKey,
    })
  }, [projection.data, queryClient])

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
    state: presentationState,
    streaming: liveForThisJob && streamConnected,
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
    onRetryProjection: () => void projection.refetch(),
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
