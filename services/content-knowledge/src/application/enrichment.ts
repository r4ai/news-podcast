import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArticleId, CapturedAt, ObjectKey } from "../domain/article.js"
import {
  ENRICHMENT_BATCH_LIMIT,
  ENRICHMENT_LEASE_MILLISECONDS,
  ENRICHMENT_MAX_ERROR_CHARACTERS,
  ENRICHMENT_MAX_MARKDOWN_CHARACTERS,
  EnrichmentProviderInputSchema,
  EnrichmentProviderOutputSchema,
  type EnrichmentProviderOutput,
  type EnrichmentQueueItem,
  type EnrichmentTarget,
} from "../domain/enrichment.js"
import type { OwnerId } from "../domain/subscription.js"
import type { InterestProfile } from "../domain/interest-profile.js"
import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
} from "./content-taxonomy.js"

export type EnrichmentQueueError = DeepReadonly<{
  readonly _tag: "EnrichmentQueueFailed"
  readonly operation:
    | "Reconcile"
    | "ListOwners"
    | "Claim"
    | "Complete"
    | "Status"
    | "Enqueue"
    | "Budget"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type EnrichmentProviderError = DeepReadonly<{
  readonly _tag: "EnrichmentProviderFailed"
  readonly reason: "Retryable" | "RateLimited" | "Permanent"
  readonly message: string
}>

export type EnrichmentSourceError = DeepReadonly<{
  readonly _tag: "EnrichmentSourceFailed"
  readonly reason: "NotFound" | "Unavailable" | "ResourceLimit"
}>

export type EnrichmentQueueStatus = DeepReadonly<{
  readonly processing: readonly EnrichmentQueueItem[]
  readonly pending: {
    readonly count: number
    readonly items: readonly EnrichmentQueueItem[]
  }
  readonly failed: {
    readonly count: number
    readonly items: readonly EnrichmentQueueItem[]
  }
  readonly recent: readonly EnrichmentQueueItem[]
  readonly daily: { readonly used: number; readonly limit: number }
  readonly reprocessable: { readonly count: number }
}>

export type EnqueueEnrichmentResult = DeepReadonly<
  | { readonly _tag: "Enqueued" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Processing" }
>

export type EnrichmentQueueRepository = DeepReadonly<{
  readonly reconcile: (
    now: CapturedAt
  ) => Effect.Effect<void, EnrichmentQueueError>
  readonly listOwners: () => Effect.Effect<
    readonly OwnerId[],
    EnrichmentQueueError
  >
  readonly claim: (
    ownerId: OwnerId,
    limit: number,
    now: CapturedAt,
    expiresAt: CapturedAt,
    leaseToken: string
  ) => Effect.Effect<readonly EnrichmentTarget[], EnrichmentQueueError>
  readonly completeSuccess: (
    ownerId: OwnerId,
    target: EnrichmentTarget,
    output: EnrichmentProviderOutput,
    completedAt: CapturedAt,
    localDate: string
  ) => Effect.Effect<void, EnrichmentQueueError | ContentTaxonomyError>
  readonly completeFailure: (
    ownerId: OwnerId,
    target: EnrichmentTarget,
    error: string,
    retryable: boolean,
    completedAt: CapturedAt
  ) => Effect.Effect<void, EnrichmentQueueError>
  readonly budgetUsed: (
    localDate: string
  ) => Effect.Effect<number, EnrichmentQueueError>
  readonly status: (
    ownerId: OwnerId,
    dailyLimit: number,
    localDate: string
  ) => Effect.Effect<EnrichmentQueueStatus, EnrichmentQueueError>
  readonly enqueueReprocess: (
    ownerId: OwnerId,
    queuedAt: CapturedAt
  ) => Effect.Effect<number, EnrichmentQueueError>
  readonly enqueueOne: (
    ownerId: OwnerId,
    articleId: ArticleId,
    queuedAt: CapturedAt
  ) => Effect.Effect<EnqueueEnrichmentResult, EnrichmentQueueError>
  readonly resetDaily: (
    localDate: string
  ) => Effect.Effect<void, EnrichmentQueueError>
}>

export type EnrichmentProvider = DeepReadonly<{
  /** The implementation must enforce its own request deadline. */
  readonly enrich: (
    input: unknown
  ) => Effect.Effect<unknown, EnrichmentProviderError>
}>

export type EnrichmentSource = DeepReadonly<{
  readonly read: (
    key: ObjectKey,
    maximumCharacters: number
  ) => Effect.Effect<string, EnrichmentSourceError>
}>

export type EnrichmentInterestProfiles = DeepReadonly<{
  readonly get: (
    ownerId: OwnerId
  ) => Effect.Effect<InterestProfile, { readonly _tag: string }>
}>

const safeMessage = (message: string): string =>
  message.slice(0, ENRICHMENT_MAX_ERROR_CHARACTERS)

const localDate = (instant: CapturedAt): string => instant.slice(0, 10)

export const createEnrichmentOperations = (input: {
  readonly queue: EnrichmentQueueRepository
  readonly taxonomy: Pick<ContentTaxonomyRepository, "vocabulary">
  readonly interestProfiles: EnrichmentInterestProfiles
  readonly source: EnrichmentSource
  readonly provider: EnrichmentProvider
  readonly dailyLimit: number
  readonly now: () => CapturedAt
  readonly newLeaseToken: () => string
}) => {
  const processTarget = Effect.fn("contentKnowledge.enrichment.processTarget")(
    function* (ownerId: OwnerId, target: EnrichmentTarget, date: string) {
      const completeFailure = (
        message: string,
        retryable: boolean
      ): Effect.Effect<void, EnrichmentQueueError> =>
        input.queue.completeFailure(
          ownerId,
          target,
          safeMessage(message),
          retryable,
          input.now()
        )

      const markdownResult = yield* input.source
        .read(target.markdownKey, ENRICHMENT_MAX_MARKDOWN_CHARACTERS)
        .pipe(
          Effect.matchEffect({
            onFailure: (sourceFailure) =>
              Effect.succeed(
                deepFreeze({ _tag: "Failure" as const, sourceFailure })
              ),
            onSuccess: (value) =>
              Effect.succeed(deepFreeze({ _tag: "Success" as const, value })),
          })
        )
      if (markdownResult._tag === "Failure") {
        yield* completeFailure(
          "article content unavailable",
          markdownResult.sourceFailure.reason === "Unavailable"
        )
        return false
      }
      const vocabulary = yield* input.taxonomy.vocabulary(ownerId)
      const interestProfile = yield* input.interestProfiles.get(ownerId)
      const providerInput = yield* parse(EnrichmentProviderInputSchema)({
        articleId: target.articleId,
        title: target.title,
        markdown: markdownResult.value,
        interestProfile,
        tagVocabulary: vocabulary,
      }).pipe(Effect.orDie)
      const providerResult = yield* input.provider.enrich(providerInput).pipe(
        Effect.matchEffect({
          onFailure: (providerFailure) =>
            Effect.succeed(
              deepFreeze({ _tag: "Failure" as const, providerFailure })
            ),
          onSuccess: (value) =>
            Effect.succeed(deepFreeze({ _tag: "Success" as const, value })),
        })
      )
      if (providerResult._tag === "Failure") {
        const typed = providerResult.providerFailure
        yield* completeFailure(typed.message, typed.reason !== "Permanent")
        return false
      }
      const decoded = yield* Effect.option(
        parse(EnrichmentProviderOutputSchema)(providerResult.value)
      )
      if (decoded._tag === "None") {
        yield* completeFailure("invalid enrichment provider response", false)
        return false
      }
      const vocabularySet = new Set(vocabulary)
      if (decoded.value.tags.some((name) => !vocabularySet.has(name))) {
        yield* completeFailure(
          "provider selected a tag outside vocabulary",
          false
        )
        return false
      }
      yield* input.queue.completeSuccess(
        ownerId,
        target,
        decoded.value,
        input.now(),
        date
      )
      return true
    }
  )

  const runCycle = Effect.fn("contentKnowledge.enrichment.runCycle")(
    function* () {
      const now = input.now()
      const date = localDate(now)
      yield* input.queue.reconcile(now)
      let used = yield* input.queue.budgetUsed(date)
      if (used >= input.dailyLimit) return deepFreeze({ processed: 0 })
      const owners = yield* input.queue.listOwners()
      let processed = 0
      for (const ownerId of owners) {
        if (used >= input.dailyLimit) break
        const limit = Math.min(ENRICHMENT_BATCH_LIMIT, input.dailyLimit - used)
        const expiresAt = new Date(
          Date.parse(now) + ENRICHMENT_LEASE_MILLISECONDS
        ).toISOString() as CapturedAt
        const targets = yield* input.queue.claim(
          ownerId,
          limit,
          now,
          expiresAt,
          input.newLeaseToken()
        )
        for (const target of targets) {
          if (yield* processTarget(ownerId, target, date)) {
            processed += 1
            used += 1
          }
        }
      }
      return deepFreeze({ processed })
    }
  )

  return deepFreeze({
    runCycle,
    status: Effect.fn("contentKnowledge.enrichment.status")(function* (
      ownerId: OwnerId
    ) {
      const now = input.now()
      return yield* input.queue.status(
        ownerId,
        input.dailyLimit,
        localDate(now)
      )
    }),
    enqueueReprocess: Effect.fn("contentKnowledge.enrichment.enqueueReprocess")(
      function* (ownerId: OwnerId) {
        return yield* input.queue.enqueueReprocess(ownerId, input.now())
      }
    ),
    enqueueOne: Effect.fn("contentKnowledge.enrichment.enqueueOne")(function* (
      ownerId: OwnerId,
      articleId: ArticleId
    ) {
      return yield* input.queue.enqueueOne(ownerId, articleId, input.now())
    }),
    resetDaily: Effect.fn("contentKnowledge.enrichment.resetDaily")(
      function* () {
        const now = input.now()
        yield* input.queue.resetDaily(localDate(now))
      }
    ),
  })
}
