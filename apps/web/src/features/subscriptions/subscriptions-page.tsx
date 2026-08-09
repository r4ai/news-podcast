import type { components } from "@news-podcast/contracts/openapi"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"

import { api } from "@/api/client"
import { PageHeader } from "@/app/page-header"
import { queryClient } from "@/app/query-client"
import { recordBrowserEvent } from "@/observability/events"

type Subscription = components["schemas"]["FeedSubscription"]

export function SubscriptionsPage() {
  const subscriptions = api.useSuspenseQuery("get", "/v1/me/feed-subscriptions")
  const feeds = api.useSuspenseQuery("get", "/v1/feeds", {
    params: { query: {} },
  })
  const patch = api.useMutation(
    "patch",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const remove = api.useMutation(
    "delete",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const add = api.useMutation("post", "/v1/me/feed-subscriptions")
  const [selectedFeedId, setSelectedFeedId] = useState("")
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [, startTransition] = useTransition()
  const queryKey = api.queryOptions("get", "/v1/me/feed-subscriptions").queryKey
  const feedById = new Map(feeds.data.items.map((feed) => [feed.id, feed]))
  const subscribedIds = new Set(
    subscriptions.data.items.map((subscription) => subscription.feedId)
  )
  const availableFeeds = feeds.data.items.filter(
    (feed) => !subscribedIds.has(feed.id)
  )

  function setItems(transform: (items: Subscription[]) => Subscription[]) {
    queryClient.setQueryData(
      queryKey,
      (current: typeof subscriptions.data | undefined) =>
        current ? { ...current, items: transform([...current.items]) } : current
    )
  }

  function setPending(id: string, value: boolean) {
    setPendingIds((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function runOptimistic(
    id: string,
    optimistic: () => void,
    request: () => Promise<void>,
    successMessage: string
  ) {
    const previous =
      queryClient.getQueryData<typeof subscriptions.data>(queryKey)
    setPending(id, true)
    optimistic()
    startTransition(async () => {
      try {
        await request()
        recordBrowserEvent("subscription.changed", { result: "succeeded" })
        toast.success(successMessage)
      } catch {
        recordBrowserEvent("subscription.changed", { result: "failed" })
        queryClient.setQueryData(queryKey, previous)
        toast.error("購読設定を更新できませんでした")
      } finally {
        setPending(id, false)
      }
    })
  }

  function toggle(item: Subscription) {
    const enabled = !item.enabled
    runOptimistic(
      item.id,
      () =>
        setItems((items) =>
          items.map((current) =>
            current.id === item.id ? { ...current, enabled } : current
          )
        ),
      async () => {
        const updated = await patch.mutateAsync({
          params: { path: { subscriptionId: item.id } },
          body: { enabled },
        })
        setItems((items) =>
          items.map((current) => (current.id === item.id ? updated : current))
        )
      },
      enabled ? "購読を有効にしました" : "購読を一時停止しました"
    )
  }

  function deleteItem(item: Subscription) {
    runOptimistic(
      item.id,
      () =>
        setItems((items) => items.filter((current) => current.id !== item.id)),
      async () => {
        await remove.mutateAsync({
          params: { path: { subscriptionId: item.id } },
        })
      },
      "購読を削除しました"
    )
  }

  function addFeed() {
    if (!selectedFeedId) return
    setPending("new", true)
    startTransition(async () => {
      try {
        const created = await add.mutateAsync({
          body: { feedId: selectedFeedId },
        })
        setItems((items) => [...items, created])
        setSelectedFeedId("")
        recordBrowserEvent("subscription.changed", {
          action: "add",
          result: "succeeded",
        })
        toast.success("購読を追加しました")
      } catch {
        recordBrowserEvent("subscription.changed", {
          action: "add",
          result: "failed",
        })
        toast.error("購読を追加できませんでした")
      } finally {
        setPending("new", false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="番組生成に使用するRSSフィードを管理します。"
        title="購読フィード"
      />

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
          {subscriptions.data.items.length > 0 ? (
            <ItemGroup>
              {subscriptions.data.items.map((item) => {
                const itemPending = pendingIds.has(item.id)
                return (
                  <Item key={item.id} role="listitem" variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {feedById.get(item.feedId)?.name ?? item.feedId}
                      </ItemTitle>
                      <ItemDescription>
                        {item.enabled ? "生成対象" : "一時停止中"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {itemPending ? <Spinner aria-label="更新中" /> : null}
                      <Switch
                        aria-label={`${feedById.get(item.feedId)?.name ?? item.feedId}を生成対象にする`}
                        checked={item.enabled}
                        disabled={itemPending}
                        onCheckedChange={() => toggle(item)}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              disabled={itemPending}
                              size="sm"
                              variant="destructive"
                            />
                          }
                        >
                          削除
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              購読を削除しますか？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {feedById.get(item.feedId)?.name ?? item.feedId}
                              は次回以降の番組へ含まれなくなります。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteItem(item)}
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
              })}
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

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>カタログから追加</h2>
          </CardTitle>
          <CardDescription>名前で検索して購読へ追加できます。</CardDescription>
        </CardHeader>
        <CardContent>
          <Combobox
            disabled={pendingIds.has("new") || availableFeeds.length === 0}
            onValueChange={(value) => setSelectedFeedId(value ?? "")}
            value={selectedFeedId}
          >
            <ComboboxInput placeholder="フィードを検索" />
            <ComboboxContent>
              <ComboboxEmpty>追加できるフィードはありません。</ComboboxEmpty>
              <ComboboxList>
                <ComboboxGroup>
                  {availableFeeds.map((feed) => (
                    <ComboboxItem key={feed.id} value={feed.id}>
                      {feed.name}
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={pendingIds.has("new") || selectedFeedId.length === 0}
            onClick={addFeed}
          >
            {pendingIds.has("new") ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            追加する
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
