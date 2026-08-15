import type { DeepReadonly } from "@news-podcast/kernel"
import type { Effect } from "effect"

import type {
  FeedSubscription,
  FeedId,
  OwnerId,
  PollingFeed,
  SubscriptionId,
} from "../../domain/subscription.js"

export type SubscriptionStoreError = DeepReadonly<{
  readonly _tag: "SubscriptionStoreFailed"
  readonly operation:
    | "Add"
    | "Delete"
    | "Update"
    | "List"
    | "ListFeeds"
    | "ListCatalog"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type AddSubscriptionResult = DeepReadonly<
  | { readonly _tag: "Added"; readonly subscription: FeedSubscription }
  | { readonly _tag: "Existing"; readonly subscription: FeedSubscription }
>

export type DeleteSubscriptionResult = DeepReadonly<
  { readonly _tag: "Deleted" } | { readonly _tag: "NotFound" }
>

export type SubscriptionStateResult = DeepReadonly<
  | {
      readonly _tag: "Updated"
      readonly subscription: FeedSubscription
      readonly enabled: boolean
    }
  | { readonly _tag: "NotFound" }
>

export type FeedCatalogEntry = DeepReadonly<{
  readonly feedId: FeedId
  readonly feedUrl: string
}>

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
  readonly setEnabled: (
    ownerId: OwnerId,
    subscriptionId: SubscriptionId,
    enabled: boolean
  ) => Effect.Effect<SubscriptionStateResult, SubscriptionStoreError>
  readonly listCatalog: (
    ownerId: OwnerId,
    query?: string
  ) => Effect.Effect<readonly FeedCatalogEntry[], SubscriptionStoreError>
  readonly listFeedsForPolling: () => Effect.Effect<
    readonly PollingFeed[],
    SubscriptionStoreError
  >
}>
