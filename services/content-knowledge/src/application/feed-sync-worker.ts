import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"
import type { FeedPollResult } from "./poll-subscriptions.js"
import type { FeedSyncQueueRepository } from "./feed-sync-queue.js"
import type { SubscriptionRepository } from "./ports/subscription.js"
import type { PollingFeed } from "../domain/subscription.js"
import type { FeedBatchContext, FeedBatchResult } from "./feed-batch.js"

export const FEED_SYNC_LEASE_MILLIS = 5 * 60 * 1_000
export const FEED_SYNC_JOB_MILLIS = 45_000
export const FEED_SYNC_CYCLE_CLAIMS = 6
export type FeedSyncObservation = Readonly<{
  event: "completed" | "budget" | "lease_lost"
  durationMillis: number
  queuedAgeMillis: number
  processed: number
  deferred: number
}>
export type FeedSyncWorkerPorts = Readonly<{
  subscriptions: Pick<SubscriptionRepository, "listFeedsForPolling">
  queue: FeedSyncQueueRepository
  pollFeed: (
    feed: PollingFeed,
    context: FeedBatchContext
  ) => Effect.Effect<FeedBatchResult, unknown>
  now: () => string
  newLeaseToken: () => string
  leaseMillis?: number
  observe?: (value: FeedSyncObservation) => void
  jobMillis?: number
}>
const empty = (): FeedPollResult =>
  deepFreeze({
    feeds: 0,
    discovered: 0,
    archived: 0,
    alreadyArchived: 0,
    failed: 0,
    failures: [],
  })
const combine = (left: FeedPollResult, right: FeedPollResult): FeedPollResult =>
  deepFreeze({
    feeds: left.feeds + right.feeds,
    discovered: left.discovered + right.discovered,
    archived: left.archived + right.archived,
    alreadyArchived: left.alreadyArchived + right.alreadyArchived,
    failed: left.failed + right.failed,
    failures: [...left.failures, ...right.failures],
  })
const failureReason = (failure: unknown): string => {
  if (typeof failure === "object" && failure !== null && "_tag" in failure) {
    if ("reason" in failure && failure.reason === "ResourceLimit")
      return "WorkBudget"
    const tag = failure._tag
    return typeof tag === "string" ? tag.slice(0, 200) : "Unavailable"
  }
  return "Unavailable"
}

/** Bounded round-robin drain; continuations never retain the worker or consume a retry. */
export const runFeedSyncCycle =
  (ports: FeedSyncWorkerPorts) => (): Effect.Effect<FeedPollResult, unknown> =>
    Effect.gen(function* () {
      yield* ports.queue.enqueueForPolling(
        yield* ports.subscriptions.listFeedsForPolling(),
        ports.now()
      )
      const leaseMillis = ports.leaseMillis ?? FEED_SYNC_LEASE_MILLIS
      const duration = Math.min(
        ports.jobMillis ?? FEED_SYNC_JOB_MILLIS,
        leaseMillis * 0.8
      )
      let result = empty()
      for (let claim = 0; claim < FEED_SYNC_CYCLE_CLAIMS; claim += 1) {
        const claimedAt = ports.now()
        const job = yield* ports.queue.claim(
          claimedAt,
          new Date(Date.parse(claimedAt) + leaseMillis).toISOString(),
          ports.newLeaseToken()
        )
        if (job === undefined) return result
        let error: string | undefined
        const outcome = yield* ports
          .pollFeed(
            { feedId: job.feedId, feedUrl: job.feedUrl },
            {
              ...(job.continuation === undefined
                ? {}
                : { continuation: job.continuation }),
              checkpoint: (snapshot) =>
                ports.queue.checkpoint(
                  job.jobId,
                  job.leaseToken,
                  snapshot,
                  ports.now()
                ),
            }
          )
          .pipe(
            Effect.catchDefect(() => Effect.fail({ _tag: "FeedWorkerDefect" })),
            Effect.timeoutOrElse({
              duration,
              orElse: () => Effect.fail({ _tag: "WorkBudget" }),
            }),
            Effect.catch((failure) => {
              error = failureReason(failure)
              return Effect.succeed<FeedBatchResult>({
                ...empty(),
                feeds: 1,
                failed: 1,
                failures: [
                  {
                    _tag: "FeedPollFailed",
                    scope: "Feed",
                    reason: "Unavailable",
                  },
                ],
              })
            })
          )
        const completedAt = ports.now()
        const failureScope = outcome.failures.some(
          (failure) => failure.scope === "Feed"
        )
          ? ("Feed" as const)
          : ("Item" as const)
        let leaseLost = false
        yield* ports.queue
          .complete(
            job.jobId,
            job.leaseToken,
            {
              discovered: outcome.discovered,
              archived: outcome.archived,
              failed: outcome.failed,
              ...(outcome.failed === 0 ? {} : { failureScope }),
              ...(error === undefined && outcome.failures[0] === undefined
                ? {}
                : { error: error ?? outcome.failures[0]!.reason }),
            },
            completedAt,
            outcome.continuation
          )
          .pipe(
            Effect.catch((failure) =>
              failure.reason === "StaleLease"
                ? Effect.sync(() => {
                    leaseLost = true
                  })
                : Effect.fail(failure)
            )
          )
        const observation: FeedSyncObservation = {
          event: leaseLost
            ? "lease_lost"
            : error === "WorkBudget" || outcome.budgetExhausted
              ? "budget"
              : "completed",
          durationMillis: Math.max(
            0,
            Date.parse(completedAt) - Date.parse(claimedAt)
          ),
          queuedAgeMillis: Math.max(
            0,
            Date.parse(claimedAt) - Date.parse(job.readyAt ?? job.createdAt)
          ),
          processed: outcome.discovered,
          deferred:
            (outcome.continuation?.items.length ?? 0) +
            (outcome.continuation?.failures.length ?? 0),
        }
        yield* ports.observe === undefined
          ? Effect.logInfo("feed sync bounded job finished", {
              event_name: "rss.sync.batch",
              ...observation,
            })
          : Effect.sync(() => ports.observe!(observation))
        result = combine(result, outcome)
      }
      return { ...result, hasPending: true }
    })
