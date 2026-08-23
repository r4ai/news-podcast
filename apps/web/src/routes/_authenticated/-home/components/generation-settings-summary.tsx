import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Clock3, Rss } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { settingsQueryOptions } from "@/features/settings"
import {
  enabledFeedNames,
  feedsQueryOptions,
  subscriptionsQueryOptions,
  type Feed,
  type Subscription,
} from "@/features/subscriptions"

export type GenerationSettingsSummaryProps = {
  readonly schedule?: {
    readonly enabled: boolean
    readonly localTime: string
    readonly timeZone: string
  }
  readonly subscriptionNames?: readonly string[]
}

/**
 * 生成時刻と購読フィードの要約。生成の進捗とは別の話なので、別の取得・別の
 * 表示境界にする。
 *
 * ここを`useGeneration`が抱えていた頃は、設定・購読・フィードの3つが揃うまで
 * 生成ステータスが出せず、購読を1つ切り替えるだけでダッシュボード全体が
 * 描き直されていた (ADR-0060)。
 */
export function GenerationSettingsSummary({
  schedule,
  subscriptionNames = [],
}: GenerationSettingsSummaryProps) {
  return (
    <aside aria-label="購読と生成設定" className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Clock3 aria-hidden="true" />
              生成時刻
            </h2>
          </CardTitle>
          <CardAction>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              to="/schedule"
            >
              変更
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="font-medium">
            {schedule?.enabled
              ? `毎日 ${schedule.localTime}`
              : "自動生成はオフ"}
          </p>
          {schedule ? (
            <p className="text-sm text-muted-foreground">{schedule.timeZone}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Rss aria-hidden="true" />
              購読フィード
            </h2>
          </CardTitle>
          <CardDescription>
            {subscriptionNames.length}件を購読中
          </CardDescription>
          <CardAction>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              to="/subscriptions"
            >
              管理
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          {subscriptionNames.length > 0 ? (
            <ul className="flex flex-col text-sm">
              {subscriptionNames.map((name, index) => (
                <li className="flex flex-col gap-3" key={name}>
                  {index > 0 ? <Separator /> : null}
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">購読はありません。</p>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

/** 2枚のカードと同じ背丈の待ち姿。取得中に隣の段組が動かないようにする。 */
export function GenerationSettingsSummarySkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4" role="status">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

/** データ接続: 自分が描く分だけを取得し、viewへ渡す。 */
export function ConnectedGenerationSettingsSummary() {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  const { data: subscriptions } = useSuspenseQuery(subscriptionsQueryOptions)
  const { data: feeds } = useSuspenseQuery(feedsQueryOptions)

  return (
    <GenerationSettingsSummary
      schedule={settings.generationSchedule}
      subscriptionNames={enabledFeedNames(
        subscriptions.items as readonly Subscription[],
        feeds.items as readonly Feed[]
      )}
    />
  )
}
