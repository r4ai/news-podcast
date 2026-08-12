import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type {
  ArticleId,
  EpisodeId,
  EpisodeJob,
  JobId,
  LeaseTokenSchema,
  OwnerId,
  RunningJob,
  UtcTimestamp,
} from "../domain/episode-job.js"
import type { ProviderFailure } from "../domain/provider-reliability.js"
import type { GeneratedScript, ScriptGenerator } from "./script-generator.js"
import type { Schema } from "effect"

export type LeaseToken = Schema.Schema.Type<typeof LeaseTokenSchema>

export type MaterializedArticle = DeepReadonly<{
  articleId: string
  snapshotId: string
  title: string
  url: string
  markdown: string
  publishedAt?: string
}>

export type ArticleSelection =
  | DeepReadonly<{ _tag: "Automatic" }>
  | DeepReadonly<{ _tag: "Selected"; articleIds: readonly ArticleId[] }>

export type PipelineFailure = DeepReadonly<{
  _tag: "PipelineFailure"
  code: string
  retryable: boolean
}>
export type LeaseFailure = DeepReadonly<
  { _tag: "StaleLease" } | { _tag: "ExecutionCanceled" }
>

export type StoredAudioCheckpoint = DeepReadonly<{
  episodeId: EpisodeId
  objectKey: string
  byteLength: number
  contentType: "audio/wav" | "audio/mpeg"
}>

export type EpisodeExecutionCheckpoint = DeepReadonly<{
  script: GeneratedScript
  audio?: StoredAudioCheckpoint
}>

export type EpisodeCompletionIntent = DeepReadonly<{
  episodeId: EpisodeId
  ownerId: OwnerId
  title: string
  script: string
  audio: StoredAudioCheckpoint
  sources: readonly {
    articleId: string
    snapshotId: string
    url: string
    title: string
    publishedAt?: string
  }[]
  completedAt: UtcTimestamp
}>

export type PersistenceResult = "Applied" | "Duplicate" | "StaleLease"

export type EpisodeExecutionPorts = DeepReadonly<{
  articles: {
    materialize: (input: {
      ownerId: OwnerId
      selection: ArticleSelection
      signal?: AbortSignal
    }) => Effect.Effect<readonly [MaterializedArticle, ...MaterializedArticle[]], PipelineFailure>
  }
  script: ScriptGenerator
  speech: {
    synthesize: (input: {
      text: string
      signal?: AbortSignal
    }) => Effect.Effect<Uint8Array, ProviderFailure>
  }
  audio: {
    put: (input: {
      ownerId: OwnerId
      episodeId: EpisodeId
      bytes: Uint8Array
      signal?: AbortSignal
    }) => Effect.Effect<StoredAudioCheckpoint, PipelineFailure>
  }
  persistence: {
    assertLease: (input: {
      jobId: JobId
      leaseToken: LeaseToken
    }) => Effect.Effect<void, LeaseFailure>
    loadCheckpoint: (
      jobId: JobId
    ) => Effect.Effect<EpisodeExecutionCheckpoint | undefined, PipelineFailure>
    saveScriptCheckpoint: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      script: GeneratedScript
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    saveAudioCheckpoint: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      audio: StoredAudioCheckpoint
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    transition: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      state: EpisodeJob
    }) => Effect.Effect<PersistenceResult, PipelineFailure>
    /** Success state and completion outbox intent must commit atomically. */
    completeWithOutbox: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      state: EpisodeJob
      completion: EpisodeCompletionIntent
    }) => Effect.Effect<PersistenceResult, PipelineFailure>
  }
  nextEpisodeId: () => EpisodeId
  now: () => UtcTimestamp
  nextRetryAt: () => UtcTimestamp
}>

export type ExecuteEpisodeJobInput = DeepReadonly<{
  job: RunningJob
  signal?: AbortSignal
}>
