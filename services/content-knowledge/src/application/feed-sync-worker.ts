import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { FeedPollResult } from "./poll-subscriptions.js"
import type { FeedSyncQueueRepository } from "./feed-sync-queue.js"
import type { SubscriptionRepository } from "./subscription-ports.js"
import type { PollingFeed } from "../domain/subscription.js"

export const FEED_SYNC_LEASE_MILLIS = 5 * 60 * 1_000

export type FeedSyncWorkerPorts = Readonly<{
  readonly subscriptions: Pick<SubscriptionRepository, "listFeedsForPolling">
  readonly queue: FeedSyncQueueRepository
  readonly pollFeed: (
    feed: PollingFeed
  ) => Effect.Effect<FeedPollResult, unknown>
  readonly now: () => string
  readonly leaseMillis?: number
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

const combine = (left: FeedPollResult, right: FeedPollResult) =>
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
    const tag = (failure as { readonly _tag?: unknown })._tag
    return typeof tag === "string" ? tag : "Unavailable"
  }
  return "Unavailable"
}

const leaseExpiry = (now: string, leaseMillis: number): string =>
  new Date(Date.parse(now) + leaseMillis).toISOString()

/** Claims one durable feed job at a time and records every terminal outcome. */
export const runFeedSyncCycle =
  (ports: FeedSyncWorkerPorts) =>
  (): Effect.Effect<FeedPollResult, unknown> => {
    const now = ports.now()
    const leaseMillis = ports.leaseMillis ?? FEED_SYNC_LEASE_MILLIS
    const processNext = (
      result: FeedPollResult
    ): Effect.Effect<FeedPollResult, unknown> =>
      Effect.suspend(() =>
        ports.queue.claim(now, leaseExpiry(now, leaseMillis)).pipe(
          Effect.flatMap((job) => {
            if (job === undefined) return Effect.succeed(result)
            return ports
              .pollFeed({
                feedId: job.feedId,
                feedUrl: job.feedUrl,
              })
              .pipe(
                Effect.matchEffect({
                  onFailure: (failure) =>
                    ports.queue
                      .complete(
                        job.jobId,
                        {
                          discovered: 0,
                          archived: 0,
                          failed: 1,
                          error: failureReason(failure),
                        },
                        now
                      )
                      .pipe(
                        Effect.andThen(
                          processNext(
                            combine(
                              result,
                              deepFreeze({
                                ...empty(),
                                feeds: 1,
                                failed: 1,
                                failures: [
                                  deepFreeze({
                                    _tag: "FeedPollFailed" as const,
                                    reason: "Unavailable" as const,
                                  }),
                                ],
                              })
                            )
                          )
                        )
                      ),
                  onSuccess: (outcome) =>
                    ports.queue
                      .complete(
                        job.jobId,
                        {
                          discovered: outcome.discovered,
                          archived: outcome.archived,
                          failed: outcome.failed,
                          ...(outcome.failures[0] === undefined
                            ? {}
                            : { error: outcome.failures[0].reason }),
                        },
                        now
                      )
                      .pipe(
                        Effect.andThen(processNext(combine(result, outcome)))
                      ),
                })
              )
          })
        )
      )

    return ports.subscriptions.listFeedsForPolling().pipe(
      Effect.flatMap((feeds) => ports.queue.enqueueForPolling(feeds, now)),
      Effect.andThen(processNext(empty()))
    )
  }
