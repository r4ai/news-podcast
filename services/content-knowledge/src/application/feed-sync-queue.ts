import type { DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  FeedSyncJob,
  FeedSyncOutcome,
  SyncJobId,
} from "../domain/feed-sync.js"
import type { FeedId, OwnerId, PollingFeed } from "../domain/subscription.js"

export type FeedSyncQueueError = DeepReadonly<{
  readonly _tag: "FeedSyncQueueFailed"
  readonly operation: "Initialize" | "Enqueue" | "List" | "Claim" | "Complete"
  readonly reason: "CorruptRecord" | "StaleLease" | "Unavailable"
}>

export type ClaimedFeedSyncJob = FeedSyncJob &
  DeepReadonly<{ readonly leaseToken: string }>

export type FeedSyncQueueRepository = DeepReadonly<{
  readonly enqueue: (
    feedId: FeedId,
    now: string
  ) => Effect.Effect<FeedSyncJob, FeedSyncQueueError>
  readonly enqueueForPolling: (
    feeds: readonly PollingFeed[],
    now: string
  ) => Effect.Effect<void, FeedSyncQueueError>
  readonly listForOwner: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly FeedSyncJob[], FeedSyncQueueError>
  readonly claim: (
    now: string,
    leaseExpiresAt: string,
    leaseToken: string
  ) => Effect.Effect<ClaimedFeedSyncJob | undefined, FeedSyncQueueError>
  readonly complete: (
    jobId: SyncJobId,
    leaseToken: string,
    outcome: FeedSyncOutcome,
    now: string
  ) => Effect.Effect<FeedSyncJob, FeedSyncQueueError>
}>
