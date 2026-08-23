import type { EpisodeFailureCode } from "@news-podcast/contracts/episode-failure"
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
} from "../../domain/episode-job.js"
import type { ReadingDictionarySnapshot } from "../../domain/reading-dictionary.js"
import type { GenerationPlan } from "../../domain/generation-plan.js"
import type { EpisodeJobStep } from "../progress/model.js"
import type { GeneratedScript, ScriptGenerator } from "./script-generator.js"
import type { SpeechSynthesizer } from "./speech-synthesizer.js"
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

export type ScriptSourceProvenance = DeepReadonly<
  Omit<MaterializedArticle, "markdown">
>

export type ArticleSelection =
  | DeepReadonly<{ _tag: "Automatic" }>
  | DeepReadonly<{ _tag: "Selected"; articleIds: readonly ArticleId[] }>

export type PipelineFailure = DeepReadonly<{
  _tag: "PipelineFailure"
  code: EpisodeFailureCode
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

export type EpisodeExecutionCheckpoint = Readonly<{
  script: GeneratedScript
  sources: readonly [ScriptSourceProvenance, ...ScriptSourceProvenance[]]
  audio?: StoredAudioCheckpoint
}>

export type EpisodeCompletionIntent = DeepReadonly<{
  episodeId: EpisodeId
  ownerId: OwnerId
  title: string
  script: string
  audio: StoredAudioCheckpoint
  sources: readonly [
    {
      articleId: string
      snapshotId: string
      url: string
      title: string
      publishedAt?: string
    },
    ...{
      articleId: string
      snapshotId: string
      url: string
      title: string
      publishedAt?: string
    }[],
  ]
  completedAt: UtcTimestamp
  /** Captured from the generation span so delayed outbox publication links traces. */
  traceparent: string
}>

export type PersistenceResult = "Applied" | "Duplicate" | "StaleLease"

export type LeaseNextInput = DeepReadonly<{
  now: UtcTimestamp
  leasedUntil: UtcTimestamp
  leaseToken: LeaseToken
}>

export type RenewLeaseInput = DeepReadonly<{
  jobId: JobId
  leaseToken: LeaseToken
  now: UtcTimestamp
  leasedUntil: UtcTimestamp
}>

export type LeaseRenewalResult = "Applied" | "StaleLease"

export type LeasedExecution = DeepReadonly<{
  job: RunningJob
  recovered: boolean
  /** State-specific ready time: lease expiry, retry due time, or enqueue time. */
  readyAt: UtcTimestamp
}>

export type AudioObjectStore = DeepReadonly<{
  put: (input: {
    ownerId: OwnerId
    jobId: JobId
    episodeId: EpisodeId
    bytes: Uint8Array
    signal?: AbortSignal
  }) => Effect.Effect<StoredAudioCheckpoint, PipelineFailure>
  remove: (objectKey: string) => Effect.Effect<void, PipelineFailure>
}>

export type EpisodeExecutionPorts = DeepReadonly<{
  planning: {
    create: (input: {
      jobId: JobId
      ownerId: OwnerId
      selection:
        | {
            readonly _tag: "Automatic"
            readonly excludedArticleIds?: readonly ArticleId[]
          }
        | { readonly _tag: "Manual"; readonly articleIds: readonly ArticleId[] }
      signal?: AbortSignal
    }) => Effect.Effect<GenerationPlan, PipelineFailure>
  }
  articles: {
    materialize: (input: {
      ownerId: OwnerId
      selection: ArticleSelection
      signal?: AbortSignal
    }) => Effect.Effect<
      readonly [MaterializedArticle, ...MaterializedArticle[]],
      PipelineFailure
    >
  }
  script: ScriptGenerator
  speech: SpeechSynthesizer
  audio: AudioObjectStore
  dictionary: {
    /** Adds inferred terms and captures the complete owner lexicon for this job. */
    prepare: (input: {
      ownerId: OwnerId
      jobId: JobId
      script: string
      signal?: AbortSignal
    }) => Effect.Effect<ReadingDictionarySnapshot, PipelineFailure>
  }
  persistence: {
    markStep: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      step: EpisodeJobStep
      phase: "started" | "finished"
      occurredAt: UtcTimestamp
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    reportStageProgress: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      step: "synthesizing_audio"
      completed: number
      total: number
      occurredAt: UtcTimestamp
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    recordSelectedArticles: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      articles: readonly Readonly<{
        articleId: string
        title: string
        sourceName: string
      }>[]
      occurredAt: UtcTimestamp
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    /** Extends only the current, still-live fencing token. */
    renewLease: (
      input: RenewLeaseInput
    ) => Effect.Effect<LeaseRenewalResult, PipelineFailure>
    assertLease: (input: {
      jobId: JobId
      leaseToken: LeaseToken
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    loadCheckpoint: (
      jobId: JobId
    ) => Effect.Effect<EpisodeExecutionCheckpoint | undefined, PipelineFailure>
    loadGenerationPlan: (
      jobId: JobId
    ) => Effect.Effect<GenerationPlan | undefined, PipelineFailure>
    listUsedAutomaticArticleIds: (
      ownerId: OwnerId
    ) => Effect.Effect<readonly ArticleId[], PipelineFailure>
    /** First write wins; returns the persisted winner on concurrent recovery. */
    saveGenerationPlan: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      plan: GenerationPlan
    }) => Effect.Effect<GenerationPlan, PipelineFailure | LeaseFailure>
    loadDictionarySnapshot: (
      jobId: JobId
    ) => Effect.Effect<ReadingDictionarySnapshot | undefined, PipelineFailure>
    /** First write wins, so retries cannot change pronunciation mid-job. */
    saveDictionarySnapshot: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      snapshot: ReadingDictionarySnapshot
    }) => Effect.Effect<void, PipelineFailure | LeaseFailure>
    saveScriptCheckpoint: (input: {
      jobId: JobId
      leaseToken: LeaseToken
      script: GeneratedScript
      sources: readonly [ScriptSourceProvenance, ...ScriptSourceProvenance[]]
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
