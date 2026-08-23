import type {
  EpisodeJobAgUiEvent,
  EpisodeJobState,
} from "@news-podcast/contracts/agui"
import {
  episodeFailureFamilyByCode,
  isEpisodeFailureCode,
  type EpisodeFailureFamily,
} from "@news-podcast/contracts/episode-failure"
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

export type FailureRecovery = "reselect" | "retry" | "new" | "admin"

type FailurePresentation = Readonly<{
  message: string
  recovery: FailureRecovery
}>

const failurePresentationByFamily = {
  deadline: {
    message: "生成が制限時間を超えました。同じ条件で再試行してください。",
    recovery: "retry",
  },
  planning_transient: {
    message:
      "生成条件を一時的に準備できませんでした。時間をおいて再試行してください。",
    recovery: "retry",
  },
  content_transient: {
    message:
      "記事本文を一時的に取得できませんでした。同じ条件で再試行してください。",
    recovery: "retry",
  },
  script_timeout: {
    message:
      "台本生成サービスが時間内に応答しませんでした。同じ条件で再試行してください。",
    recovery: "retry",
  },
  script_transient: {
    message:
      "台本生成サービスを一時的に利用できません。同じ条件で再試行してください。",
    recovery: "retry",
  },
  script_terminal: {
    message:
      "台本生成サービスの設定または応答を確認する必要があります。管理者へ連絡してください。",
    recovery: "admin",
  },
  speech_timeout: {
    message:
      "音声生成サービスが時間内に応答しませんでした。同じ条件で再試行してください。",
    recovery: "retry",
  },
  speech_transient: {
    message:
      "音声生成サービスを一時的に利用できません。同じ条件で再試行してください。",
    recovery: "retry",
  },
  speech_terminal: {
    message:
      "音声生成サービスの設定または応答を確認する必要があります。管理者へ連絡してください。",
    recovery: "admin",
  },
  input_invalid: {
    message: "生成条件を確認できませんでした。記事を選び直してください。",
    recovery: "reselect",
  },
  no_candidates: {
    message:
      "番組にできる新しい記事がありません。記事を選んで生成してください。",
    recovery: "reselect",
  },
  storage_transient: {
    message: "番組を保存できませんでした。時間をおいて再試行してください。",
    recovery: "retry",
  },
  checkpoint_invalid: {
    message:
      "保存済みデータを安全に処理できませんでした。問い合わせIDを添えて管理者へ連絡してください。",
    recovery: "admin",
  },
  publication_transient: {
    message:
      "完成した番組を連携できませんでした。問い合わせIDを添えて管理者へ連絡してください。",
    recovery: "admin",
  },
  internal_invariant: {
    message:
      "生成状態を安全に確認できませんでした。問い合わせIDを添えて管理者へ連絡してください。",
    recovery: "admin",
  },
} satisfies Record<EpisodeFailureFamily, FailurePresentation>

const unknownFailurePresentation: FailurePresentation = {
  message: "生成中に問題が発生しました。時間をおいて再試行してください。",
  recovery: "retry",
}

const failurePresentation = (code: string): FailurePresentation =>
  isEpisodeFailureCode(code)
    ? failurePresentationByFamily[episodeFailureFamilyByCode[code]]
    : unknownFailurePresentation

export function failureRecovery(code?: string): FailureRecovery {
  return code === undefined ? "new" : failurePresentation(code).recovery
}

export function failureMessage(
  failure?: {
    readonly code: string
    readonly message: string
  },
  jobId?: string
): string | undefined {
  if (!failure) return undefined
  const message = failurePresentation(failure.code).message
  return !isEpisodeFailureCode(failure.code) && jobId !== undefined
    ? `${message}問い合わせID: ${jobId}`
    : message
}

const activeStatuses = new Set<JobStatus>(["queued", "running", "retrying"])

export function hasActiveJob(
  jobs: readonly { readonly status: JobStatus }[]
): boolean {
  return jobs.some((job) => activeStatuses.has(job.status))
}

/** Prefer actionable work over a newer terminal history entry. */
export function selectTrackedJob<Job extends { readonly status: JobStatus }>(
  jobs: readonly Job[]
): Job | undefined {
  return jobs.find((job) => activeStatuses.has(job.status)) ?? jobs[0]
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
  /**
   * このストリームがどのジョブのものか。
   *
   * 畳み込み結果はアプリ全体で1つのatomにあり、画面を離れても残る。読む側が
   * 「今見ているジョブのものか」を判断できないと、戻ってきた最初の1描画で
   * 前のジョブの状態が出る。由来を値に含めることで、突き合わせが純粋な比較で
   * 済む (ADR-0060の「前の値を覚えるstateを作らない」)。
   */
  readonly jobId?: string
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

/** そのジョブのために開かれた、まだ何も届いていないストリーム。 */
export function openingGenerationStream(jobId: string): GenerationStream {
  return { ...emptyGenerationStream, jobId }
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
