import { EventSchemas, type AGUIEvent } from "@ag-ui/core"

/** The stage vocabulary is an application contract carried by standard AG-UI events. */
export const episodeJobSteps = [
  "selecting_articles",
  "materializing_articles",
  "generating_script",
  "preparing_pronunciation",
  "synthesizing_audio",
  "storing_episode",
] as const

export type EpisodeJobStep = (typeof episodeJobSteps)[number]

export interface SelectedArticle {
  readonly articleId: string
  /** Present after the immutable article snapshot has been materialized. */
  readonly title?: string
  /** The publisher/feed name; present after materialization. */
  readonly sourceName?: string
}

export interface EpisodeJobState {
  readonly jobId: string
  readonly status:
    | "queued"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "canceled"
  readonly attempt: number
  readonly maxAttempts: 4
  readonly selectionMode: "automatic" | "manual"
  readonly selectedArticles: readonly SelectedArticle[]
  readonly currentStage?: EpisodeJobStep
  readonly failure?: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
  }
  readonly episodeId?: string
}

type Timestamped = Readonly<{ timestamp?: number }>
export type EpisodeJobAgUiEvent =
  | (Timestamped &
      Readonly<{ type: "RUN_STARTED"; threadId: string; runId: string }>)
  | (Timestamped &
      Readonly<{
        type: "RUN_FINISHED"
        threadId: string
        runId: string
        outcome?: Readonly<{ type: "success" }>
      }>)
  | (Timestamped &
      Readonly<{
        type: "RUN_ERROR"
        message: string
        code?: string
      }>)
  | (Timestamped &
      Readonly<{
        type: "STEP_STARTED" | "STEP_FINISHED"
        stepName: EpisodeJobStep
      }>)
  | (Timestamped &
      Readonly<{
        type: "STATE_SNAPSHOT"
        snapshot: EpisodeJobState
      }>)

/**
 * Runtime validation deliberately delegates the envelope to the pinned official
 * AG-UI package. Application state is checked separately by API boundaries.
 */
export function parseAgUiEvent(value: unknown): AGUIEvent {
  return EventSchemas.parse(value)
}

export function parseEpisodeJobAgUiEvent(value: unknown): EpisodeJobAgUiEvent {
  const event = parseAgUiEvent(value)
  switch (event.type) {
    case "RUN_STARTED":
    case "RUN_FINISHED":
    case "RUN_ERROR":
    case "STEP_STARTED":
    case "STEP_FINISHED":
    case "STATE_SNAPSHOT":
      return event as EpisodeJobAgUiEvent
    default:
      throw new Error(`Unsupported episode job AG-UI event: ${event.type}`)
  }
}

/** GET transport extension: only `id` and the official JSON event are emitted. */
export function encodeSse(input: {
  readonly id?: number
  readonly event: EpisodeJobAgUiEvent
}): string {
  const lines = [
    ...(input.id === undefined ? [] : [`id: ${input.id}`]),
    `data: ${JSON.stringify(input.event)}`,
  ]
  return `${lines.join("\n")}\n\n`
}
