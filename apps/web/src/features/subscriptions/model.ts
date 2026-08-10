import type { components } from "@news-podcast/contracts/openapi"

export type Subscription = components["schemas"]["FeedSubscription"]
export type Feed = components["schemas"]["Feed"]

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
}
