import { Effect } from "effect"
import type { FeedReadResult } from "./ports/article-catalog.js"
import type { FeedSyncQueueError } from "./feed-sync-queue.js"
import {
  pollFeed,
  type FeedPollResult,
  type PollSubscriptionsPorts,
} from "./poll-subscriptions.js"
import type { PollingFeed } from "../domain/subscription.js"

export type FeedBatchContext = Readonly<{
  continuation?: FeedReadResult
  checkpoint: (
    snapshot: FeedReadResult
  ) => Effect.Effect<void, FeedSyncQueueError>
}>
export type FeedBatchResult = FeedPollResult &
  Readonly<{ continuation?: FeedReadResult; budgetExhausted?: boolean }>

/** One archive per claim. Save the normalized snapshot before any article side effects. */
export const pollFeedBatch =
  (ports: PollSubscriptionsPorts) =>
  (
    feed: PollingFeed,
    context: FeedBatchContext
  ): Effect.Effect<FeedBatchResult, unknown> =>
    (context.continuation === undefined
      ? ports.reader.read(feed.feedUrl).pipe(Effect.tap(context.checkpoint))
      : Effect.succeed(context.continuation)
    ).pipe(
      Effect.flatMap((snapshot) => {
        let budgetExhausted = false
        const hasItem = snapshot.items.length > 0
        const batch: FeedReadResult = {
          items: snapshot.items.slice(0, 1),
          failures: hasItem ? [] : snapshot.failures.slice(0, 1),
        }
        const remaining: FeedReadResult = {
          items: snapshot.items.slice(1),
          failures: hasItem ? snapshot.failures : snapshot.failures.slice(1),
        }
        return pollFeed({
          ...ports,
          reader: { read: () => Effect.succeed(batch) },
          archive: (invocation) =>
            ports.archive(invocation).pipe(
              Effect.timeoutOrElse({
                duration: 30_000,
                orElse: () => {
                  budgetExhausted = true
                  return Effect.fail({
                    _tag: "CaptureFailed" as const,
                    reason: "ResourceLimit" as const,
                  })
                },
              })
            ),
        })(feed).pipe(
          Effect.map((result) => ({
            ...result,
            budgetExhausted,
            ...(result.failures.some((failure) => failure.scope === "Feed") ||
            remaining.items.length + remaining.failures.length === 0
              ? {}
              : { continuation: remaining }),
          }))
        )
      })
    )
