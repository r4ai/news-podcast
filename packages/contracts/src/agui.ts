/**
 * AG-UI (Agent User Interaction Protocol) のイベント定義と、
 * `episode_job_events` 行からの変換。
 *
 * 型は `@ag-ui/core` をそのまま使わず手で定義している。あのパッケージは
 * 型のためだけに zod ^3 を実行時依存として持ち込み、本リポジトリの zod 4 と
 * 二重化してしまうため。ワイヤフォーマットは仕様どおりなので、任意の
 * AG-UI クライアントがこのストリームをそのまま消費できる。
 *
 * @see https://docs.ag-ui.com/concepts/events
 */

export const AgUiEventType = {
  RunStarted: "RUN_STARTED",
  RunFinished: "RUN_FINISHED",
  RunError: "RUN_ERROR",
  StepStarted: "STEP_STARTED",
  StepFinished: "STEP_FINISHED",
  ToolCallStart: "TOOL_CALL_START",
  ToolCallArgs: "TOOL_CALL_ARGS",
  ToolCallEnd: "TOOL_CALL_END",
  ToolCallResult: "TOOL_CALL_RESULT",
  StateSnapshot: "STATE_SNAPSHOT",
  StateDelta: "STATE_DELTA",
  Custom: "CUSTOM",
} as const

export type AgUiEventTypeValue =
  (typeof AgUiEventType)[keyof typeof AgUiEventType]

interface AgUiBaseEvent {
  readonly type: AgUiEventTypeValue
  readonly timestamp: number
}

export interface RunStartedEvent extends AgUiBaseEvent {
  readonly type: "RUN_STARTED"
  readonly threadId: string
  readonly runId: string
}

export interface RunFinishedEvent extends AgUiBaseEvent {
  readonly type: "RUN_FINISHED"
  readonly threadId: string
  readonly runId: string
  readonly result?: unknown
}

export interface RunErrorEvent extends AgUiBaseEvent {
  readonly type: "RUN_ERROR"
  readonly message: string
  readonly code?: string
}

export interface StepStartedEvent extends AgUiBaseEvent {
  readonly type: "STEP_STARTED"
  readonly stepName: string
}

export interface StepFinishedEvent extends AgUiBaseEvent {
  readonly type: "STEP_FINISHED"
  readonly stepName: string
}

export interface ToolCallStartEvent extends AgUiBaseEvent {
  readonly type: "TOOL_CALL_START"
  readonly toolCallId: string
  readonly toolCallName: string
}

export interface ToolCallArgsEvent extends AgUiBaseEvent {
  readonly type: "TOOL_CALL_ARGS"
  readonly toolCallId: string
  readonly delta: string
}

export interface ToolCallEndEvent extends AgUiBaseEvent {
  readonly type: "TOOL_CALL_END"
  readonly toolCallId: string
}

export interface ToolCallResultEvent extends AgUiBaseEvent {
  readonly type: "TOOL_CALL_RESULT"
  readonly messageId: string
  readonly toolCallId: string
  readonly content: string
}

export interface StateSnapshotEvent extends AgUiBaseEvent {
  readonly type: "STATE_SNAPSHOT"
  readonly snapshot: EpisodeJobState
}

/** RFC 6902 JSON Patch の 1 操作。 */
export interface JsonPatchOperation {
  readonly op: "add" | "remove" | "replace"
  readonly path: string
  readonly value?: unknown
}

export interface StateDeltaEvent extends AgUiBaseEvent {
  readonly type: "STATE_DELTA"
  readonly delta: readonly JsonPatchOperation[]
}

export interface CustomEvent extends AgUiBaseEvent {
  readonly type: "CUSTOM"
  readonly name: string
  readonly value: unknown
}

export type AgUiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | CustomEvent

// --- このエージェントが公開する state の形 ---

export interface AdoptedArticle {
  readonly articleId: string
  readonly title: string
  readonly url: string
  readonly sourceName: string
}

export interface EpisodeJobState {
  readonly jobId: string
  readonly status: string
  readonly stage?: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly progress?: {
    readonly completed: number
    readonly total: number
  }
  readonly adoptedArticles: readonly AdoptedArticle[]
  readonly failure?: {
    readonly code: string
    readonly message: string
  }
  readonly episodeId?: string
}

// --- DB のイベント行 → AG-UI イベント ---

export interface JobEventRow {
  readonly sequence: number
  readonly eventType: string
  readonly attempt: number
  readonly stage?: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly createdAt: string
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

/**
 * 1 行のジョブイベントを 0 個以上の AG-UI イベントに変換する。
 * ツール呼び出しは AG-UI の作法どおり START → ARGS → END → RESULT に展開する。
 */
export function toAgUiEvents(
  jobId: string,
  row: JobEventRow
): readonly AgUiEvent[] {
  const timestamp = Date.parse(row.createdAt) || Date.now()
  const base = { timestamp } as const

  switch (row.eventType) {
    case "lease_acquired":
    case "lease_recovered":
      return [{ ...base, type: "RUN_STARTED", threadId: jobId, runId: jobId }]

    case "stage.started":
      return row.stage
        ? [{ ...base, type: "STEP_STARTED", stepName: row.stage }]
        : []

    case "stage.finished":
      return row.stage
        ? [{ ...base, type: "STEP_FINISHED", stepName: row.stage }]
        : []

    case "agent.tool_call": {
      const toolCallId = `${jobId}:${row.sequence}`
      const name = asString(row.payload.name, "unknown")
      const args = asString(row.payload.arguments, "{}")
      return [
        { ...base, type: "TOOL_CALL_START", toolCallId, toolCallName: name },
        { ...base, type: "TOOL_CALL_ARGS", toolCallId, delta: args },
        { ...base, type: "TOOL_CALL_END", toolCallId },
        {
          ...base,
          type: "TOOL_CALL_RESULT",
          messageId: toolCallId,
          toolCallId,
          content: JSON.stringify(row.payload.outputSummary ?? null),
        },
      ]
    }

    case "agent.article_adopted":
      return [
        {
          ...base,
          type: "STATE_DELTA",
          delta: [
            {
              op: "add",
              path: "/adoptedArticles/-",
              value: {
                articleId: asString(row.payload.articleId),
                title: asString(row.payload.title),
                url: asString(row.payload.url),
                sourceName: asString(row.payload.sourceName),
              },
            },
          ],
        },
      ]

    case "tts.progress":
      return [
        {
          ...base,
          type: "STATE_DELTA",
          delta: [
            {
              op: "replace",
              path: "/progress",
              value: {
                completed: Number(row.payload.completed ?? 0),
                total: Number(row.payload.total ?? 0),
              },
            },
          ],
        },
      ]

    case "job.retrying":
      return [
        {
          ...base,
          type: "CUSTOM",
          name: "job.retrying",
          value: row.payload,
        },
      ]

    case "job.succeeded":
      return [
        {
          ...base,
          type: "RUN_FINISHED",
          threadId: jobId,
          runId: jobId,
          result: row.payload,
        },
      ]

    case "job.failed":
      return [
        {
          ...base,
          type: "RUN_ERROR",
          message: asString(row.payload.message, "Generation failed"),
          code: asString(row.payload.code, "unknown"),
        },
      ]

    case "job.canceled":
      return [
        { ...base, type: "RUN_ERROR", message: "Canceled", code: "canceled" },
      ]

    default:
      // 未知のイベントは落とさず CUSTOM で通す。ワーカー側が先に増えても
      // クライアントは壊れない。
      return [
        {
          ...base,
          type: "CUSTOM",
          name: row.eventType,
          value: row.payload,
        },
      ]
  }
}

/** SSE の 1 フレームに整形する。`id` は Last-Event-ID として使われる。 */
export function encodeSse(input: {
  readonly id?: number
  readonly event: AgUiEvent
}): string {
  const lines = [
    ...(input.id === undefined ? [] : [`id: ${input.id}`]),
    `event: ${input.event.type}`,
    `data: ${JSON.stringify(input.event)}`,
  ]
  return `${lines.join("\n")}\n\n`
}
