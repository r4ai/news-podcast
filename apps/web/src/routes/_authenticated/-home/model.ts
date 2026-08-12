import type { AgUiEvent, EpisodeJobState } from "@news-podcast/contracts/agui"
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
  researching_sources: "記事を調査中",
  fetching_sources: "RSSを取得中",
  generating_script: "台本を生成中",
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

export function failureMessage(failure?: {
  readonly code: string
  readonly message: string
}): string | undefined {
  return failure
    ? (failureMessages[failure.code] ?? failure.message)
    : undefined
}

const activeStatuses = new Set<JobStatus>(["queued", "running", "retrying"])

export function hasActiveJob(
  jobs: readonly { readonly status: JobStatus }[]
): boolean {
  return jobs.some((job) => activeStatuses.has(job.status))
}

const stageProgress = {
  researching_sources: 35,
  fetching_sources: 20,
  generating_script: 45,
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

export type TimelineToolCall = {
  readonly kind: "tool"
  readonly toolCallId: string
  readonly name: string
  readonly label: string
  readonly args?: string
  readonly result?: string
  readonly done: boolean
}

export type TimelineEntry = TimelineStep | TimelineToolCall

export type AdoptedArticle = EpisodeJobState["adoptedArticles"][number]

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

const toolLabels: Readonly<Record<string, string>> = {
  list_rss_articles: "記事一覧を確認",
  read_article: "記事を読む",
  web_search: "Webで裏取り",
  submit_episode_draft: "台本を提出",
}

export function toolLabel(name: string): string {
  return toolLabels[name] ?? name
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
  event: AgUiEvent
): GenerationStream {
  switch (event.type) {
    case "STATE_SNAPSHOT":
      return { ...current, state: event.snapshot, finished: false }

    case "RUN_STARTED":
      return { ...current, finished: false }

    case "STEP_STARTED": {
      if (current.timeline.some(isSameStep(event.stepName))) return current
      const label = isJobStage(event.stepName)
        ? stageLabel(event.stepName)
        : event.stepName
      return {
        ...current,
        ...(current.state
          ? { state: { ...current.state, stage: event.stepName } }
          : {}),
        timeline: [
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

    case "TOOL_CALL_START":
      return {
        ...current,
        timeline: [
          ...current.timeline,
          {
            kind: "tool",
            toolCallId: event.toolCallId,
            name: event.toolCallName,
            label: toolLabel(event.toolCallName),
            done: false,
          },
        ],
      }

    case "TOOL_CALL_ARGS":
      return patchTool(current, event.toolCallId, (tool) => ({
        ...tool,
        args: `${tool.args ?? ""}${event.delta}`,
      }))

    case "TOOL_CALL_RESULT":
      return patchTool(current, event.toolCallId, (tool) => ({
        ...tool,
        result: event.content,
        done: true,
      }))

    case "TOOL_CALL_END":
      return patchTool(current, event.toolCallId, (tool) => ({
        ...tool,
        done: true,
      }))

    case "STATE_DELTA":
      return event.delta.reduce(applyPatch, current)

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
                },
              },
            }
          : {}),
      }

    default:
      return current
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

function patchTool(
  current: GenerationStream,
  toolCallId: string,
  patch: (tool: TimelineToolCall) => TimelineToolCall
): GenerationStream {
  return {
    ...current,
    timeline: current.timeline.map((entry) =>
      entry.kind === "tool" && entry.toolCallId === toolCallId
        ? patch(entry)
        : entry
    ),
  }
}

/**
 * RFC 6902 のうち、このエージェントが実際に送る操作だけを実装する。
 * 汎用のJSON Patch実装を持ち込むほどの形状ではない。
 */
function applyPatch(
  current: GenerationStream,
  operation: {
    readonly op: string
    readonly path: string
    readonly value?: unknown
  }
): GenerationStream {
  if (operation.op === "add" && operation.path === "/adoptedArticles/-") {
    const article = operation.value as AdoptedArticle
    if (
      current.adoptedArticles.some((it) => it.articleId === article.articleId)
    ) {
      return current
    }
    return {
      ...current,
      adoptedArticles: [...current.adoptedArticles, article],
    }
  }
  if (operation.op === "replace" && operation.path === "/progress") {
    const progress = operation.value as { completed: number; total: number }
    return {
      ...current,
      ...(current.state ? { state: { ...current.state, progress } } : {}),
    }
  }
  return current
}
