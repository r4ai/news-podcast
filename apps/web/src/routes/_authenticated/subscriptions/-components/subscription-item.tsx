import {
  AlertCircle,
  LoaderCircle,
  MoreVertical,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Switch } from "@workspace/ui/components/switch"

import {
  isFeedSyncActive,
  type FeedSyncJob,
  type Subscription,
} from "@/features/subscriptions"

export type SubscriptionItemProps = {
  readonly subscription: Subscription
  readonly feedName: string
  readonly disabled: boolean
  readonly job?: FeedSyncJob
  readonly onToggle: (subscription: Subscription) => void
  readonly onRemove: (subscription: Subscription) => void
  readonly onSync: (subscription: Subscription) => void
}

function statusText(subscription: Subscription, job: FeedSyncJob | undefined) {
  if (job && isFeedSyncActive(job)) return "同期中…"
  if (job?.status === "failed") return "前回の同期に失敗しました"
  if (job?.status === "succeeded" && job.failed > 0)
    return `前回の同期で${job.failed}件の記事を取得できませんでした`
  return subscription.enabled ? "生成対象" : "一時停止中"
}

export function SubscriptionItem({
  disabled,
  feedName,
  job,
  onRemove,
  onSync,
  onToggle,
  subscription,
}: SubscriptionItemProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const syncing = job !== undefined && isFeedSyncActive(job)
  const degraded = job?.status === "succeeded" && job.failed > 0

  return (
    <Item role="listitem" variant="outline">
      {syncing ? (
        <ItemMedia variant="icon">
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin text-muted-foreground"
          />
        </ItemMedia>
      ) : job?.status === "failed" || degraded ? (
        <ItemMedia variant="icon">
          <AlertCircle
            aria-hidden="true"
            className={degraded ? "text-amber-600" : "text-destructive"}
          />
        </ItemMedia>
      ) : null}
      <ItemContent>
        <ItemTitle>{feedName}</ItemTitle>
        <ItemDescription>{statusText(subscription, job)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={`${feedName}を生成対象にする`}
          checked={subscription.enabled}
          disabled={disabled}
          onCheckedChange={() => onToggle(subscription)}
        />
        <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`${feedName}の操作`}
                disabled={disabled}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <MoreVertical aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={syncing || !subscription.enabled}
              onClick={() => onSync(subscription)}
            >
              <RefreshCw aria-hidden="true" />
              今すぐ同期
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setConfirmOpen(true)
              }}
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>購読を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {feedName}は次回以降の番組へ含まれなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onRemove(subscription)}
              variant="destructive"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Item>
  )
}
