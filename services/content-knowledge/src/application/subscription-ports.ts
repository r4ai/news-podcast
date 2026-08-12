import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type {
  FeedSubscription,
  OwnerId,
  PollingFeed,
  SubscriptionId,
} from "../domain/subscription.js"

export type SubscriptionStoreError = DeepReadonly<{
  readonly _tag: "SubscriptionStoreFailed"
  readonly operation: "Add" | "Delete" | "List" | "ListFeeds"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type AddSubscriptionResult = DeepReadonly<
  | { readonly _tag: "Added"; readonly subscription: FeedSubscription }
  | { readonly _tag: "Existing"; readonly subscription: FeedSubscription }
>

export type DeleteSubscriptionResult = DeepReadonly<
  { readonly _tag: "Deleted" } | { readonly _tag: "NotFound" }
>

export type SubscriptionRepository = DeepReadonly<{
  readonly add: (
    subscription: FeedSubscription
  ) => Effect.Effect<AddSubscriptionResult, SubscriptionStoreError>
  readonly list: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly FeedSubscription[], SubscriptionStoreError>
  readonly remove: (
    ownerId: OwnerId,
    subscriptionId: SubscriptionId
  ) => Effect.Effect<DeleteSubscriptionResult, SubscriptionStoreError>
  readonly listFeedsForPolling: () => Effect.Effect<
    readonly PollingFeed[],
    SubscriptionStoreError
  >
}>
