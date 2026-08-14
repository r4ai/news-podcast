import { LoaderCircle, RefreshCw } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Switch } from "@workspace/ui/components/switch"

import type { Subscription } from "@/features/subscriptions"

export type SubscriptionItemProps = {
  readonly subscription: Subscription
  readonly feedName: string
  readonly disabled: boolean
  readonly onToggle: (subscription: Subscription) => void
  readonly onRemove: (subscription: Subscription) => void
  readonly onSync: (subscription: Subscription) => void
}

export function SubscriptionItem({
  disabled,
  feedName,
  onRemove,
  onSync,
  onToggle,
  subscription,
}: SubscriptionItemProps) {
  return (
    <Item role="listitem" variant="outline">
      <ItemContent>
        <ItemTitle>{feedName}</ItemTitle>
        <ItemDescription>
          {subscription.enabled ? "生成対象" : "一時停止中"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          aria-label={`${feedName}を今すぐ同期`}
          disabled={disabled || !subscription.enabled}
          onClick={() => onSync(subscription)}
          size="sm"
          variant="outline"
        >
          {disabled ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          同期
        </Button>
        <Switch
          aria-label={`${feedName}を生成対象にする`}
          checked={subscription.enabled}
          disabled={disabled}
          onCheckedChange={() => onToggle(subscription)}
        />
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button disabled={disabled} size="sm" variant="destructive" />
            }
          >
            削除
          </AlertDialogTrigger>
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
      </ItemActions>
    </Item>
  )
}
