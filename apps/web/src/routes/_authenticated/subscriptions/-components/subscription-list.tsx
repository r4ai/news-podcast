import { useSuspenseQuery } from "@tanstack/react-query"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { ItemGroup } from "@workspace/ui/components/item"

import {
  compareFeedNames,
  feedNameResolver,
  feedsQueryOptions,
  feedSyncJobsQueryOptions,
  type Feed,
  type FeedSyncJob,
  type Subscription,
} from "@/features/subscriptions"
import { useSubscriptions } from "../-hooks/use-subscriptions"
import { SubscriptionItem } from "./subscription-item"

/** feedIdごとに最新のjobだけを残す。 */
function latestJobByFeedId(
  jobs: readonly FeedSyncJob[]
): ReadonlyMap<string, FeedSyncJob> {
  const byFeedId = new Map<string, FeedSyncJob>()
  for (const job of jobs) {
    const current = byFeedId.get(job.feedId)
    if (!current || job.createdAt > current.createdAt) {
      byFeedId.set(job.feedId, job)
    }
  }
  return byFeedId
}

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function SubscriptionList() {
  const { items, pending, removeItem, syncItem, toggle } = useSubscriptions()
  const { data: feeds } = useSuspenseQuery(feedsQueryOptions)
  const { data: jobs } = useSuspenseQuery(feedSyncJobsQueryOptions)

  return (
    <SubscriptionListView
      feeds={feeds.items as readonly Feed[]}
      jobs={jobs.items as readonly FeedSyncJob[]}
      onRemove={removeItem}
      onSync={syncItem}
      onToggle={toggle}
      pending={pending}
      subscriptions={items}
    />
  )
}

export type SubscriptionListViewProps = {
  readonly subscriptions: readonly Subscription[]
  readonly feeds: readonly Feed[]
  readonly jobs?: readonly FeedSyncJob[]
  readonly pending: boolean
  readonly onToggle: (subscription: Subscription) => void
  readonly onRemove: (subscription: Subscription) => void
  readonly onSync: (subscription: Subscription) => void
}

export function SubscriptionListView({
  feeds,
  jobs = [],
  onRemove,
  onSync,
  onToggle,
  pending,
  subscriptions,
}: SubscriptionListViewProps) {
  const feedName = feedNameResolver(feeds)
  const jobByFeedId = latestJobByFeedId(jobs)
  const sortedSubscriptions = subscriptions.toSorted((left, right) =>
    compareFeedNames(feedName(left.feedId), feedName(right.feedId))
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>現在の購読</h2>
        </CardTitle>
        <CardDescription>
          有効なフィードだけが次回の番組生成へ含まれます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subscriptions.length > 0 ? (
          <ItemGroup>
            {sortedSubscriptions.map((subscription) => (
              <SubscriptionItem
                disabled={pending}
                feedName={feedName(subscription.feedId)}
                job={jobByFeedId.get(subscription.feedId)}
                key={subscription.id}
                onRemove={onRemove}
                onSync={onSync}
                onToggle={onToggle}
                subscription={subscription}
              />
            ))}
          </ItemGroup>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>購読中のフィードはありません</EmptyTitle>
              <EmptyDescription>
                下のカタログから最初のフィードを追加してください。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}
