import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  RetryableFailureSchema,
  TerminalFailureSchema,
  cancelJob,
  completeRunningJob,
  failRunningJob,
  retryRunningJob,
  type RunningJob,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import { classifyProviderFailure } from "../domain/provider-reliability.js"
import type { ScriptGenerationFailure } from "./ports/script-generator.js"
import type { SpeechSynthesisFailure } from "./ports/speech-synthesizer.js"
import type {
  EpisodeCompletionIntent,
  EpisodeExecutionPorts,
  ExecuteEpisodeJobInput,
  LeaseFailure,
  PipelineFailure,
} from "./ports/execution.js"

export type EpisodeExecutionOutcome =
  | Readonly<{ _tag: "Succeeded" }>
  | Readonly<{ _tag: "Duplicate" }>
  | Readonly<{
      _tag: "Retrying"
      failureCode: string
      retryAt: UtcTimestamp
    }>
  | Readonly<{ _tag: "Failed"; failureCode: string }>
  | Readonly<{ _tag: "Canceled" }>
  | Readonly<{ _tag: "StaleLease" }>

type ProviderStage = "script" | "speech"
type StagedProviderFailure = Readonly<{
  _tag: "StagedProviderFailure"
  stage: ProviderStage
  failure: ScriptGenerationFailure | SpeechSynthesisFailure
}>
type ExecutionFailure = LeaseFailure | PipelineFailure | StagedProviderFailure

const withProviderStage =
  (stage: ProviderStage) =>
  (
    failure: ScriptGenerationFailure | SpeechSynthesisFailure
  ): StagedProviderFailure =>
    deepFreeze({
      _tag: "StagedProviderFailure",
      stage,
      failure,
    })

const canceled = (): LeaseFailure => deepFreeze({ _tag: "ExecutionCanceled" })

const failWhenCanceled = (
  signal: AbortSignal | undefined
): Effect.Effect<void, LeaseFailure | PipelineFailure> => {
  if (!signal?.aborted) return Effect.void
  if (signal.reason !== "job_deadline_exceeded") return Effect.fail(canceled())
  return Effect.fail(
    deepFreeze({
      _tag: "PipelineFailure",
      code: "job_deadline_exceeded",
      retryable: false,
    })
  )
}

const isTagged = (failure: unknown, tag: string) =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === tag

const providerFailure = (
  failure: ScriptGenerationFailure | SpeechSynthesisFailure
) =>
  isTagged(failure, "ProviderRetryExhausted")
    ? (
        failure as Extract<
          ScriptGenerationFailure,
          { _tag: "ProviderRetryExhausted" }
        >
      ).lastFailure
    : failure

const providerReasonCode = (
  reason: ReturnType<typeof classifyProviderFailure>["reason"]
) =>
  ({
    RateLimited: "rate_limited",
    Unavailable: "unavailable",
    Timeout: "timeout",
    Incomplete: "incomplete",
    ClientError: "client_error",
    Canceled: "canceled",
    MalformedResponse: "malformed_response",
    Refusal: "refusal",
    UnexpectedStatus: "unexpected_status",
  })[reason]

const classify = (failure: ExecutionFailure) => {
  if (isTagged(failure, "ExecutionCanceled") || isTagged(failure, "Canceled")) {
    return { _tag: "Canceled" as const, code: "canceled" }
  }
  if (isTagged(failure, "StaleLease")) {
    return { _tag: "StaleLease" as const, code: "stale_lease" }
  }
  if (isTagged(failure, "PipelineFailure")) {
    const pipeline = failure as PipelineFailure
    return {
      _tag: pipeline.retryable ? ("Retryable" as const) : ("Terminal" as const),
      code: pipeline.code,
    }
  }
  const staged = failure as StagedProviderFailure
  const provider = providerFailure(staged.failure) as Parameters<
    typeof classifyProviderFailure
  >[0]
  if (provider._tag === "Canceled") {
    return { _tag: "Canceled" as const, code: "canceled" }
  }
  const classification = classifyProviderFailure(provider, Date.now())
  return {
    _tag: classification.retryable
      ? ("Retryable" as const)
      : ("Terminal" as const),
    code: `${staged.stage}_${providerReasonCode(classification.reason)}`,
  }
}

const transitionFailure = (
  ports: EpisodeExecutionPorts,
  job: RunningJob,
  failure: ExecutionFailure
): Effect.Effect<EpisodeExecutionOutcome, PipelineFailure> => {
  const classified = classify(failure)
  if (classified._tag === "StaleLease") {
    return Effect.succeed(deepFreeze({ _tag: "StaleLease" }))
  }
  const now = ports.now()
  if (classified._tag === "Canceled") {
    return ports.persistence
      .transition({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        state: cancelJob(job, {
          canceledAt: now,
          reason: "requested_by_user",
        }),
      })
      .pipe(
        Effect.map((result) =>
          result === "StaleLease"
            ? deepFreeze({ _tag: "StaleLease" as const })
            : deepFreeze({ _tag: "Canceled" as const })
        )
      )
  }
  if (classified._tag === "Retryable" && job.attempt < 4) {
    const retryAt = ports.nextRetryAt()
    const retryable = Schema.decodeUnknownSync(RetryableFailureSchema)({
      code: classified.code,
      retryable: true,
    })
    return ports.persistence
      .transition({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        state: retryRunningJob(job as never, {
          retryAt,
          failure: retryable,
        }),
      })
      .pipe(
        Effect.map((result) =>
          result === "StaleLease"
            ? deepFreeze({ _tag: "StaleLease" as const })
            : deepFreeze({
                _tag: "Retrying" as const,
                failureCode: classified.code,
                retryAt,
              })
        )
      )
  }
  const terminal = Schema.decodeUnknownSync(TerminalFailureSchema)({
    code: classified.code,
    retryable: false,
  })
  return ports.persistence
    .transition({
      jobId: job.jobId,
      leaseToken: job.lease.token,
      state: failRunningJob(job, { failedAt: now, failure: terminal }),
    })
    .pipe(
      Effect.map((result) =>
        result === "StaleLease"
          ? deepFreeze({ _tag: "StaleLease" as const })
          : deepFreeze({
              _tag: "Failed" as const,
              failureCode: classified.code,
            })
      )
    )
}

export const executeEpisodeJob =
  (ports: EpisodeExecutionPorts) =>
  (
    input: ExecuteEpisodeJobInput
  ): Effect.Effect<EpisodeExecutionOutcome, PipelineFailure> => {
    const { job, signal } = input
    const assertLease = () =>
      failWhenCanceled(signal).pipe(
        Effect.andThen(
          ports.persistence.assertLease({
            jobId: job.jobId,
            leaseToken: job.lease.token,
          })
        )
      )
    const markStep = (
      step: Parameters<
        EpisodeExecutionPorts["persistence"]["markStep"]
      >[0]["step"],
      phase: "started" | "finished"
    ) =>
      ports.persistence.markStep({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        step,
        phase,
        occurredAt: ports.now(),
      })

    const run = Effect.gen(function* () {
      yield* assertLease()
      const checkpoint = yield* ports.persistence.loadCheckpoint(job.jobId)
      yield* markStep("selecting_articles", "started")
      let generationPlan = yield* ports.persistence.loadGenerationPlan(
        job.jobId
      )
      if (generationPlan === undefined) {
        const excludedArticleIds =
          job.request.articleIds === undefined
            ? yield* ports.persistence.listUsedAutomaticArticleIds(
                job.request.ownerId
              )
            : []
        generationPlan = yield* ports.planning.create({
          jobId: job.jobId,
          ownerId: job.request.ownerId,
          selection:
            job.request.articleIds === undefined
              ? deepFreeze({
                  _tag: "Automatic" as const,
                  excludedArticleIds,
                })
              : deepFreeze({
                  _tag: "Manual" as const,
                  articleIds: job.request.articleIds,
                }),
          ...(signal === undefined ? {} : { signal }),
        })
        yield* assertLease()
        generationPlan = yield* ports.persistence.saveGenerationPlan({
          jobId: job.jobId,
          leaseToken: job.lease.token,
          plan: generationPlan,
        })
      }
      if (
        generationPlan.jobId !== job.jobId ||
        generationPlan.ownerId !== job.request.ownerId
      ) {
        return yield* Effect.fail<PipelineFailure>(
          deepFreeze({
            _tag: "PipelineFailure",
            code: "generation_plan_owner_mismatch",
            retryable: false,
          })
        )
      }
      yield* markStep("selecting_articles", "finished")
      let dictionarySnapshot = yield* ports.persistence.loadDictionarySnapshot(
        job.jobId
      )
      if (
        dictionarySnapshot !== undefined &&
        dictionarySnapshot.ownerId !== job.request.ownerId
      ) {
        return yield* Effect.fail<PipelineFailure>(
          deepFreeze({
            _tag: "PipelineFailure",
            code: "dictionary_snapshot_owner_mismatch",
            retryable: false,
          })
        )
      }
      yield* markStep("materializing_articles", "started")
      const articles = yield* ports.articles.materialize({
        ownerId: job.request.ownerId,
        selection: deepFreeze({
          _tag: "Selected" as const,
          articleIds: generationPlan.selectedArticleIds,
        }),
        ...(signal === undefined ? {} : { signal }),
      })
      yield* ports.persistence.recordSelectedArticles({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        articles: articles.map((article) => ({
          articleId: article.articleId,
          title: article.title,
          sourceName: new URL(article.url).hostname,
        })),
        occurredAt: ports.now(),
      })
      yield* markStep("materializing_articles", "finished")

      let script = checkpoint?.script
      if (script === undefined) {
        yield* markStep("generating_script", "started")
        yield* assertLease()
        script = yield* ports.script
          .generate({
            sources: articles.map(({ title, url, markdown }) => ({
              title,
              url,
              markdown,
            })),
            interestProfile: generationPlan.interestProfile,
            ...(signal === undefined ? {} : { signal }),
          })
          .pipe(Effect.mapError(withProviderStage("script")))
        yield* assertLease()
        yield* ports.persistence.saveScriptCheckpoint({
          jobId: job.jobId,
          leaseToken: job.lease.token,
          script,
        })
        yield* markStep("generating_script", "finished")
      }

      if (dictionarySnapshot === undefined) {
        yield* markStep("preparing_pronunciation", "started")
        const dictionary = yield* ports.dictionary.prepare({
          ownerId: job.request.ownerId,
          jobId: job.jobId,
          script: script.script,
          ...(signal === undefined ? {} : { signal }),
        })
        if (dictionary.ownerId !== job.request.ownerId) {
          return yield* Effect.fail<PipelineFailure>(
            deepFreeze({
              _tag: "PipelineFailure",
              code: "dictionary_snapshot_owner_mismatch",
              retryable: false,
            })
          )
        }
        yield* assertLease()
        yield* ports.persistence.saveDictionarySnapshot({
          jobId: job.jobId,
          leaseToken: job.lease.token,
          snapshot: dictionary,
        })
        dictionarySnapshot = dictionary
        yield* markStep("preparing_pronunciation", "finished")
      }

      const used = script.sourceUrls.map((url) =>
        articles.find((candidate) => candidate.url === url)
      )
      if (used.some((source) => source === undefined) || used.length === 0) {
        return yield* Effect.fail<PipelineFailure>(
          deepFreeze({
            _tag: "PipelineFailure",
            code: "invalid_script_sources",
            retryable: false,
          })
        )
      }

      let audio = checkpoint?.audio
      if (audio === undefined) {
        yield* markStep("synthesizing_audio", "started")
        yield* assertLease()
        const bytes = yield* ports.speech
          .synthesize({
            text: script.script,
            dictionarySnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          .pipe(Effect.mapError(withProviderStage("speech")))
        yield* markStep("synthesizing_audio", "finished")
        yield* markStep("storing_episode", "started")
        yield* assertLease()
        const uploaded = yield* ports.audio.put({
          ownerId: job.request.ownerId,
          jobId: job.jobId,
          episodeId: ports.nextEpisodeId(),
          bytes,
          ...(signal === undefined ? {} : { signal }),
        })
        audio = yield* assertLease().pipe(
          Effect.andThen(
            ports.persistence.saveAudioCheckpoint({
              jobId: job.jobId,
              leaseToken: job.lease.token,
              audio: uploaded,
            })
          ),
          Effect.as(uploaded),
          Effect.matchEffect({
            onFailure: (failure) =>
              ports.audio.remove(uploaded.objectKey).pipe(
                Effect.matchEffect({
                  onFailure: () =>
                    Effect.logWarning("abandoned audio cleanup failed", {
                      event_name: "episode.audio_cleanup_failed",
                      job_id: job.jobId,
                    }),
                  onSuccess: () => Effect.void,
                }),
                Effect.andThen(Effect.fail(failure))
              ),
            onSuccess: Effect.succeed,
          })
        )
        yield* markStep("storing_episode", "finished")
      }
      const completedAt = ports.now()
      const span = yield* Effect.orDie(Effect.currentSpan)
      const state = completeRunningJob(job, {
        episodeId: audio.episodeId,
        completedAt,
      })
      const result = yield* ports.persistence.completeWithOutbox({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        state,
        completion: deepFreeze({
          episodeId: audio.episodeId,
          ownerId: job.request.ownerId,
          title: script.title,
          script: script.script,
          audio,
          sources: used.map((source) => ({
            articleId: source!.articleId,
            snapshotId: source!.snapshotId,
            url: source!.url,
            title: source!.title,
            ...(source!.publishedAt === undefined
              ? {}
              : { publishedAt: source!.publishedAt }),
          })) as EpisodeCompletionIntent["sources"],
          completedAt,
          traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
        }),
      })
      return result === "Duplicate"
        ? deepFreeze({ _tag: "Duplicate" as const })
        : result === "StaleLease"
          ? deepFreeze({ _tag: "StaleLease" as const })
          : deepFreeze({ _tag: "Succeeded" as const })
    })

    return run.pipe(
      Effect.matchEffect({
        onFailure: (failure) => transitionFailure(ports, job, failure),
        onSuccess: Effect.succeed,
      }),
      Effect.withSpan("episodeProduction.executeJob")
    )
  }
