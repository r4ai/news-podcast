import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react"
import { useSuspenseQuery } from "@tanstack/react-query"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import {
  feedNameResolver,
  feedsQueryOptions,
  isFeedSyncActive,
  type Feed,
  type FeedSyncJob,
} from "@/features/subscriptions"
import { api } from "@/shared/api"

const statusCopy = {
  queued: { label: "待機中", variant: "secondary" as const },
  processing: { label: "同期中", variant: "default" as const },
  succeeded: { label: "完了", variant: "outline" as const },
  failed: { label: "失敗", variant: "destructive" as const },
} as const

function statusIcon(status: FeedSyncJob["status"]) {
  switch (status) {
    case "queued":
      return (
        <Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
      )
    case "processing":
      return <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
    case "succeeded":
      return (
        <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
      )
    case "failed":
      return (
        <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
      )
  }
}

function statusDescription(job: FeedSyncJob): string {
  if (job.status === "queued")
    return "RSSの取得待ちです。まもなく同期を開始します。"
  if (job.status === "processing") {
    return job.discovered > 0
      ? `記事を保存中です（${job.archived}/${job.discovered}件）。`
      : "RSSを取得して新しい記事を確認しています。"
  }
  if (job.status === "succeeded") {
    return job.discovered > 0
      ? `${job.archived}件の記事を記事一覧に登録しました。`
      : "新しい記事はありませんでした。"
  }
  if (job.attempt >= job.maxAttempts) {
    return "同期に失敗し、試行上限に達しました。購読を再登録すると再試行できます。"
  }
  return job.error
    ? `同期に失敗しました（${job.error}）。次回の定期同期で再試行します。`
    : "同期に失敗しました。次回の定期同期で再試行します。"
}

export function FeedSyncStatus() {
  const { data: feeds } = useSuspenseQuery(feedsQueryOptions)
  const jobsQuery = api.useQuery("get", "/v1/me/feed-sync-jobs", undefined, {
    refetchInterval: (query) =>
      query.state.data?.items.some(isFeedSyncActive) ? 1_000 : false,
  })

  return (
    <FeedSyncStatusView
      feeds={feeds.items as readonly Feed[]}
      isPending={jobsQuery.isPending}
      jobs={(jobsQuery.data?.items ?? []) as readonly FeedSyncJob[]}
    />
  )
}

export type FeedSyncStatusViewProps = {
  readonly feeds: readonly Feed[]
  readonly jobs: readonly FeedSyncJob[]
  readonly isPending: boolean
}

export function FeedSyncStatusView({
  feeds,
  isPending,
  jobs,
}: FeedSyncStatusViewProps) {
  const feedName = feedNameResolver(feeds)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>記事の同期状態</h2>
        </CardTitle>
        <CardDescription>
          RSSの取得と記事保存はバックグラウンドで行います。処理中は自動更新されます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div
            aria-label="同期状態を読み込み中"
            className="flex justify-center py-4"
            role="status"
          >
            <Spinner />
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            現在処理中の同期はありません。
          </p>
        ) : (
          <ItemGroup>
            {jobs.map((job) => {
              const copy = statusCopy[job.status]
              return (
                <Item key={job.jobId} variant="muted">
                  <ItemMedia variant="icon">{statusIcon(job.status)}</ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {feedName(job.feedId)}
                      <Badge variant={copy.variant}>{copy.label}</Badge>
                    </ItemTitle>
                    <ItemDescription>{statusDescription(job)}</ItemDescription>
                  </ItemContent>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  )
}
