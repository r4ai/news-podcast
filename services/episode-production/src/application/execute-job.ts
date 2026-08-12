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
} from "../domain/episode-job.js"
import { classifyProviderFailure } from "../domain/provider-reliability.js"
import type { ScriptGenerationFailure } from "./script-generator.js"
import type {
  EpisodeCompletionIntent,
  EpisodeExecutionPorts,
  ExecuteEpisodeJobInput,
  LeaseFailure,
  PipelineFailure,
} from "./execution-ports.js"

export type EpisodeExecutionOutcome =
  | Readonly<{ _tag: "Succeeded" }>
  | Readonly<{ _tag: "Duplicate" }>
  | Readonly<{ _tag: "Retrying" }>
  | Readonly<{ _tag: "Failed" }>
  | Readonly<{ _tag: "Canceled" }>
  | Readonly<{ _tag: "StaleLease" }>

type ExecutionFailure = LeaseFailure | PipelineFailure | ScriptGenerationFailure

const canceled = (): LeaseFailure => deepFreeze({ _tag: "ExecutionCanceled" })

const failWhenCanceled = (signal: AbortSignal | undefined) =>
  signal?.aborted ? Effect.fail(canceled()) : Effect.void

const isTagged = (failure: unknown, tag: string) =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === tag

const providerFailure = (failure: ExecutionFailure) =>
  isTagged(failure, "ProviderRetryExhausted")
    ? (
        failure as Extract<
          ScriptGenerationFailure,
          { _tag: "ProviderRetryExhausted" }
        >
      ).lastFailure
    : failure

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
  const provider = providerFailure(failure) as Parameters<
    typeof classifyProviderFailure
  >[0]
  const classification = classifyProviderFailure(provider, Date.now())
  return {
    _tag: classification.retryable
      ? ("Retryable" as const)
      : ("Terminal" as const),
    code: `provider_${classification.reason.toLowerCase()}`,
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
    const retryable = Schema.decodeUnknownSync(RetryableFailureSchema)({
      code: classified.code,
      retryable: true,
    })
    return ports.persistence
      .transition({
        jobId: job.jobId,
        leaseToken: job.lease.token,
        state: retryRunningJob(job as never, {
          retryAt: ports.nextRetryAt(),
          failure: retryable,
        }),
      })
      .pipe(
        Effect.map((result) =>
          result === "StaleLease"
            ? deepFreeze({ _tag: "StaleLease" as const })
            : deepFreeze({ _tag: "Retrying" as const })
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
          : deepFreeze({ _tag: "Failed" as const })
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

    const run = Effect.gen(function* () {
      yield* assertLease()
      const checkpoint = yield* ports.persistence.loadCheckpoint(job.jobId)
      let dictionarySnapshot =
        yield* ports.persistence.loadDictionarySnapshot(job.jobId)
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
      if (dictionarySnapshot === undefined) {
        const dictionary = yield* ports.dictionary.capture(job.request.ownerId)
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
      }
      const selection =
        job.request.articleIds === undefined
          ? deepFreeze({ _tag: "Automatic" as const })
          : deepFreeze({
              _tag: "Selected" as const,
              articleIds: job.request.articleIds,
            })
      const articles = yield* ports.articles.materialize({
        ownerId: job.request.ownerId,
        selection,
        ...(signal === undefined ? {} : { signal }),
      })

      let script = checkpoint?.script
      if (script === undefined) {
        yield* assertLease()
        script = yield* ports.script.generate({
          sources: articles.map(({ title, url, markdown }) => ({
            title,
            url,
            markdown,
          })),
          ...(signal === undefined ? {} : { signal }),
        })
        yield* assertLease()
        yield* ports.persistence.saveScriptCheckpoint({
          jobId: job.jobId,
          leaseToken: job.lease.token,
          script,
        })
      }

      let audio = checkpoint?.audio
      if (audio === undefined) {
        yield* assertLease()
        const bytes = yield* ports.speech.synthesize({
          text: script.script,
          dictionarySnapshot,
          ...(signal === undefined ? {} : { signal }),
        })
        yield* assertLease()
        audio = yield* ports.audio.put({
          ownerId: job.request.ownerId,
          jobId: job.jobId,
          episodeId: ports.nextEpisodeId(),
          bytes,
          ...(signal === undefined ? {} : { signal }),
        })
        yield* assertLease()
        yield* ports.persistence.saveAudioCheckpoint({
          jobId: job.jobId,
          leaseToken: job.lease.token,
          audio,
        })
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
          })) as unknown as EpisodeCompletionIntent["sources"],
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
