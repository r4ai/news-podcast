import { createFileRoute } from "@tanstack/react-router"

import {
  feedSyncJobsQueryOptions,
  feedsQueryOptions,
  subscriptionsQueryOptions,
} from "@/features/subscriptions"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { pageTitle } from "@/shared/lib/page-title"
import { AddFeedCard } from "./-components/add-feed-card"
import { SubscriptionList } from "./-components/subscription-list"

export const Route = createFileRoute("/_authenticated/subscriptions/")({
  head: () => ({ meta: [{ title: pageTitle("購読フィード") }] }),
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
      {/* 追加操作が失敗しても、購読一覧は操作可能なまま残す。 */}
      <Panel name="add-feed">
        <AddFeedCard />
      </Panel>
      <Panel name="subscription-list">
        <SubscriptionList />
      </Panel>
    </div>
  )
}
