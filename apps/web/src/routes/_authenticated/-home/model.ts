import type {
  EpisodeJobAgUiEvent,
  EpisodeJobState,
} from "@news-podcast/contracts/agui"
import type { components } from "@news-podcast/contracts/openapi"

export type JobStatus = components["schemas"]["JobStatus"]
export type JobStage = components["schemas"]["JobStage"]

/** APIの `POST /v1/episode-jobs` が受け付ける上限と揃える。 */
export const MAX_SELECTED_ARTICLES = 20

export function selectionLabel(count: number): string {
  return count === 0
    ? "記事を選択してください"
    : `${count}/${MAX_SELECTED_ARTICLES}件を選択中`
}

const statusLabels = {
  queued: "待機中",
  running: "生成中",
  retrying: "再試行待ち",
  succeeded: "完成",
  failed: "失敗",
  canceled: "キャンセル",
} satisfies Record<JobStatus, string>

const stageLabels = {
  selecting_articles: "記事を選定中",
  materializing_articles: "記事本文を固定中",
  generating_script: "台本を生成中",
  preparing_pronunciation: "読み方を準備中",
  synthesizing_audio: "音声を生成中",
  storing_episode: "番組を保存中",
} satisfies Record<JobStage, string>

export const statusLabel = (status: JobStatus) => statusLabels[status]
export const stageLabel = (stage: JobStage) => stageLabels[stage]

/** SSEの終端状態を、追従が遅れる一覧APIより優先して画面状態を確定する。 */
export function resolvedJobStatus(
  streamed: JobStatus | undefined,
  polled: JobStatus | undefined
): JobStatus | "ready" {
  return streamed ?? polled ?? "ready"
}

const failureMessages: Readonly<Record<string, string>> = {
  "provider-timeout":
    "外部サービスが時間内に応答しませんでした。自動再試行または手動再試行を利用できます。",
  "provider-unavailable":
    "外部サービスを一時的に利用できませんでした。時間をおいて再試行してください。",
  "job-deadline-exceeded": "生成時間が30分の安全上限を超えたため停止しました。",
  "attempt-limit-exceeded": "自動試行の上限4回に達したため停止しました。",
  "checkpoint-corruption":
    "保存済みの生成途中データを検証できなかったため、安全に停止しました。",
  "legacy-execution-invalidated":
    "旧方式で実行中だった生成を安全のため停止しました。新しい方式で再試行してください。",
  "pipeline-input-invalid":
    "生成結果を検証できませんでした。内容を変えて再試行してください。",
}

export type FailureRecovery = "reselect" | "retry" | "new" | "admin"

const terminalProviderReasons = [
  "client_error",
  "malformed_response",
  "refusal",
  "unexpected_status",
] as const

const isTerminalStagedProviderFailure = (code: string): boolean =>
  (code.startsWith("script_") || code.startsWith("speech_")) &&
  terminalProviderReasons.some((reason) => code.endsWith(`_${reason}`))

export function failureRecovery(code?: string): FailureRecovery {
  if (
    code === "content_materialization_invalid" ||
    code === "content_materialization_empty"
  )
    return "reselect"
  if (code && isTerminalStagedProviderFailure(code)) return "admin"
  if (
    code?.startsWith("script_") ||
    code?.startsWith("speech_") ||
    code?.startsWith("provider_") ||
    code === "content_materialization_unavailable"
  )
    return "retry"
  if (
    code?.includes("checkpoint") ||
    code?.includes("storage") ||
    code?.includes("owner_mismatch") ||
    code?.includes("stale_lease")
  )
    return "admin"
  return "new"
}

export function failureMessage(failure?: {
  readonly code: string
  readonly message: string
}): string | undefined {
  if (!failure) return undefined
  if (isTerminalStagedProviderFailure(failure.code))
    return "外部サービスの設定または応答契約を確認する必要があります。管理者へ連絡してください。"
  if (failure.code.startsWith("script_"))
    return "台本生成サービスで失敗しました。同じ条件で再試行できます。"
  if (failure.code.startsWith("speech_"))
    return "音声生成サービスで失敗しました。同じ条件で再試行できます。"
  if (failure.code.startsWith("provider_"))
    return "外部サービスで失敗しました。同じ条件で再試行できます。"
  if (
    failure.code.startsWith("checkpoint_") ||
    failure.code.includes("storage")
  )
    return "保存済みデータを安全に処理できませんでした。管理者確認後に新規生成してください。"
  return failureMessages[failure.code] ?? failure.message
}

const activeStatuses = new Set<JobStatus>(["queued", "running", "retrying"])

export function hasActiveJob(
  jobs: readonly { readonly status: JobStatus }[]
): boolean {
  return jobs.some((job) => activeStatuses.has(job.status))
}

const stageProgress = {
  selecting_articles: 10,
  materializing_articles: 25,
  generating_script: 45,
  preparing_pronunciation: 60,
  synthesizing_audio: 75,
  storing_episode: 90,
} satisfies Record<JobStage, number>

export function stagePercent(stage?: JobStage): number | undefined {
  return stage ? stageProgress[stage] : undefined
}

// --- AG-UIイベント → 画面状態 ---

export type TimelineStep = {
  readonly kind: "step"
  readonly stepName: string
  readonly label: string
  readonly done: boolean
}

export type TimelineEntry = TimelineStep

export type AdoptedArticle = EpisodeJobState["selectedArticles"][number]

export type GenerationStream = {
  readonly connected: boolean
  readonly state?: EpisodeJobState
  readonly timeline: readonly TimelineEntry[]
  readonly adoptedArticles: readonly AdoptedArticle[]
  readonly finished: boolean
}

export const emptyGenerationStream: GenerationStream = {
  connected: false,
  timeline: [],
  adoptedArticles: [],
  finished: false,
}

export type JobFailure = NonNullable<EpisodeJobState["failure"]>

/**
 * 採用記事の一覧が実質同じか。
 *
 * `STATE_SNAPSHOT`は進捗のたびに届き、そのたびに採用記事の配列を作り直す。
 * 参照で比べると「中身は同じなのに別物」と見えて、購読側が毎フレーム
 * 描き直される。何をもって同じとするかをここで決める。
 */
export function sameAdoptedArticles(
  a: readonly AdoptedArticle[],
  b: readonly AdoptedArticle[]
): boolean {
  return (
    a.length === b.length &&
    a.every((article, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        article.articleId === other.articleId &&
        article.title === other.title &&
        article.sourceName === other.sourceName
      )
    })
  )
}

/** 失敗の同一性。表示に使うのはcodeとmessageだけなので、その2つで決める。 */
export function sameJobFailure(
  a: JobFailure | undefined,
  b: JobFailure | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.code === b.code && a.message === b.message
}

function isJobStage(value: string): value is JobStage {
  return value in stageLabels
}

/**
 * AG-UIイベントを1件畳み込む純粋なreducer。ここが進捗表示の唯一の真実で、
 * 描画側は結果を並べるだけ。イベント列さえ与えれば環境非依存にテストできる。
 */
export function reduceGenerationStream(
  current: GenerationStream,
  event: EpisodeJobAgUiEvent
): GenerationStream {
  switch (event.type) {
    case "STATE_SNAPSHOT":
      return {
        ...current,
        state: event.snapshot,
        adoptedArticles: event.snapshot.selectedArticles,
        finished: ["succeeded", "failed", "canceled"].includes(
          event.snapshot.status
        ),
      }

    case "RUN_STARTED":
      return {
        ...current,
        finished: false,
        ...(current.state
          ? { state: { ...current.state, status: "running" } }
          : {}),
      }

    case "STEP_STARTED": {
      const existing = current.timeline.find(isSameStep(event.stepName))
      if (existing && !existing.done) return current
      const label = isJobStage(event.stepName)
        ? stageLabel(event.stepName)
        : event.stepName
      return {
        ...current,
        ...(current.state
          ? {
              state: {
                ...current.state,
                currentStage: event.stepName as never,
              },
            }
          : {}),
        timeline: existing
          ? current.timeline.map((entry) =>
              isSameStep(event.stepName)(entry)
                ? { ...entry, done: false }
                : entry
            )
          : [
              ...current.timeline,
              { kind: "step", stepName: event.stepName, label, done: false },
            ],
      }
    }

    case "STEP_FINISHED":
      return {
        ...current,
        timeline: current.timeline.map((entry) =>
          isSameStep(event.stepName)(entry) ? { ...entry, done: true } : entry
        ),
      }

    case "RUN_FINISHED":
      return {
        ...current,
        finished: true,
        timeline: finishTimeline(current.timeline),
        ...(current.state
          ? { state: { ...current.state, status: "succeeded" } }
          : {}),
      }

    case "RUN_ERROR":
      return {
        ...current,
        finished: true,
        timeline: finishTimeline(current.timeline),
        ...(current.state
          ? {
              state: {
                ...current.state,
                status: event.code === "canceled" ? "canceled" : "failed",
                failure: {
                  code: event.code ?? "unknown",
                  message: event.message,
                  retryable: false,
                },
              },
            }
          : {}),
      }
  }
}

function finishTimeline(
  timeline: readonly TimelineEntry[]
): readonly TimelineEntry[] {
  return timeline.map((entry) =>
    entry.done ? entry : { ...entry, done: true }
  )
}

const isSameStep =
  (stepName: string) =>
  (entry: TimelineEntry): entry is TimelineStep =>
    entry.kind === "step" && entry.stepName === stepName
