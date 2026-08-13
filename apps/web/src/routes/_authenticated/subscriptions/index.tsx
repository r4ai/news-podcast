import { createFileRoute } from "@tanstack/react-router"

import {
  feedSyncJobsQueryOptions,
  feedsQueryOptions,
  subscriptionsQueryOptions,
} from "@/features/subscriptions"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { FeedCatalogCard } from "./-components/feed-catalog-card"
import { FeedSyncStatus } from "./-components/feed-sync-status"
import { RegisterFeedCard } from "./-components/register-feed-card"
import { SubscriptionList } from "./-components/subscription-list"

export const Route = createFileRoute("/_authenticated/subscriptions/")({
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(subscriptionsQueryOptions)
    void context.queryClient.ensureQueryData(feedsQueryOptions)
    void context.queryClient.ensureQueryData(feedSyncJobsQueryOptions)
  },
  component: SubscriptionsRoute,
})

function SubscriptionsRoute() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="番組生成に使用するRSSフィードを管理します。"
        title="購読フィード"
      />
      {/* カタログの取得が失敗しても、購読一覧とURL登録は操作可能なまま残す。 */}
      <Panel name="register-feed">
        <RegisterFeedCard />
      </Panel>
      <Panel name="subscription-list">
        <SubscriptionList />
      </Panel>
      <Panel name="feed-sync-status">
        <FeedSyncStatus />
      </Panel>
      <Panel name="feed-catalog">
        <FeedCatalogCard />
      </Panel>
    </div>
  )
}
