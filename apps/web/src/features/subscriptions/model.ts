import type { components } from "@news-podcast/contracts/openapi"

export type Subscription = components["schemas"]["FeedSubscription"]
export type Feed = components["schemas"]["Feed"]
export type FeedSyncJob = components["schemas"]["FeedSyncJob"]

export function isFeedSyncActive(job: FeedSyncJob): boolean {
  return job.status === "queued" || job.status === "processing"
}

/** OSのlocale実装に依存せず、visual testと表示順を安定させる。 */
export function compareFeedNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** 購読は feedId しか持たないので、表示名はフィード一覧から解決する。 */
export function feedNameResolver(feeds: readonly Feed[]) {
  const byId = new Map(feeds.map((feed) => [feed.id, feed]))
  return (feedId: string) => byId.get(feedId)?.name ?? feedId
}

export function enabledFeedNames(
  subscriptions: readonly Subscription[],
  feeds: readonly Feed[]
): readonly string[] {
  const nameOf = feedNameResolver(feeds)
  return subscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => nameOf(subscription.feedId))
    .toSorted(compareFeedNames)
}
