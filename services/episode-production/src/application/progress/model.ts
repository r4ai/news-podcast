export type EpisodeJobStep =
  | "selecting_articles"
  | "materializing_articles"
  | "generating_script"
  | "preparing_pronunciation"
  | "synthesizing_audio"
  | "storing_episode"

export type ProgressArticle = Readonly<{
  articleId: string
  title?: string
  sourceName?: string
}>

export type ProgressState = Readonly<{
  jobId: string
  status:
    | "queued"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "canceled"
  attempt: number
  maxAttempts: 4
  selectionMode: "automatic" | "manual"
  selectedArticles: readonly ProgressArticle[]
  currentStage?: EpisodeJobStep
  stageProgress?: Readonly<{ completed: number; total: number }>
  failure?: Readonly<{ code: string; message: string; retryable: boolean }>
  episodeId?: string
}>

export type DurableAgUiEvent = Readonly<{
  runId: string
  eventType: string
  occurredAt: string
  payload: string
  eventKey: string
}>

export const runIdFor = (jobId: string, attempt: number): string =>
  `${jobId}:attempt:${attempt}`
