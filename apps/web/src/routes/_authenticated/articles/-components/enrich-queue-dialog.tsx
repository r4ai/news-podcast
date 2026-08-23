import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PauseCircle,
  RefreshCw,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import type {
  EnrichQueueItem,
  EnrichQueueStatus,
} from "@/features/enrich/queue"
import {
  useEnrichQueueDialog,
  type EnrichQueueDialogState,
} from "../-hooks/use-enrich-queue"

export type EnrichQueueDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly status: EnrichQueueDialogState["status"]
  readonly connected: boolean
}

/**
 * データ接続。開閉はatomが持つので、routeから状態を配らない。
 * 開いたことでrouteが描き直され、一覧まで巻き添えになるのを避ける。
 */
export function ConnectedEnrichQueueDialog() {
  const dialog = useEnrichQueueDialog()
  return <EnrichQueueDialog {...dialog} />
}

export function EnrichQueueDialog({
  open,
  onOpenChange,
  status,
  connected,
}: EnrichQueueDialogProps) {
  const limitReached = Boolean(
    status && status.daily.used >= status.daily.limit
  )
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto" size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            AI処理キュー
            {connected ? (
              <span
                aria-label="ライブ接続中"
                className="flex size-2 items-center justify-center rounded-full bg-emerald-500"
              />
            ) : (
              <RefreshCw
                aria-label="ポーリング中"
                className="size-3 animate-spin text-muted-foreground"
              />
            )}
          </DialogTitle>
        </DialogHeader>

        <DailyBudget daily={status?.daily} />

        {status?.processing.length ? (
          <QueueSection
            icon={
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            }
            label={`処理中 ${status.processing.length}件`}
            items={status.processing}
            variant="processing"
          />
        ) : null}

        <QueueSection
          icon={
            limitReached ? (
              <PauseCircle
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            ) : (
              <Clock
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            )
          }
          label={`${limitReached ? "本日の上限待ち" : "待ち"} ${status?.pending.count ?? 0}件`}
          items={status?.pending.items ?? []}
          variant="pending"
        />

        <QueueSection
          icon={
            <AlertTriangle
              aria-hidden="true"
              className="size-3.5 text-destructive"
            />
          }
          label={`失敗 ${status?.failed.count ?? 0}件`}
          items={status?.failed.items ?? []}
          variant="failed"
        />

        {status && status.recent.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              最近の結果
            </h3>
            <ul className="flex flex-col gap-px">
              {status.recent.slice(0, 10).map((item) => (
                <RecentItem item={item} key={item.feedItemId} />
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DailyBudget({
  daily,
}: {
  readonly daily: EnrichQueueStatus["daily"] | undefined
}) {
  if (!daily) return null
  const percent = Math.min(100, Math.round((daily.used / daily.limit) * 100))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>本日のAI試行上限</span>
        <span className="tabular-nums">
          {daily.used} / {daily.limit}回
        </span>
      </div>
      <Progress aria-label="本日のAI試行上限の使用率" value={percent} />
      {daily.used >= daily.limit ? (
        <p className="text-xs text-destructive">
          本日の上限に達しています。明日のバッチで再開されます。
        </p>
      ) : null}
    </div>
  )
}

function statusBadge(variant: QueueSectionVariant) {
  switch (variant) {
    case "processing":
      return {
        label: "処理中",
        className:
          "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
      }
    case "pending":
      return {
        label: "待ち",
        className: "bg-muted text-muted-foreground",
      }
    case "failed":
      return {
        label: "失敗",
        className:
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      }
  }
}

type QueueSectionVariant = "processing" | "pending" | "failed"

function QueueSection({
  icon,
  label,
  items,
  variant,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly items: readonly EnrichQueueItem[]
  readonly variant: QueueSectionVariant
}) {
  const badge = statusBadge(variant)

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </h3>
      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">ありません</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.feedItemId}
              className="rounded-lg border bg-card px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-1 text-sm font-medium">
                  {item.title}
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[0.625rem] font-medium",
                    badge.className
                  )}
                >
                  {badge.label}
                </span>
              </div>
              {variant === "failed" && item.error ? (
                <p className="mt-1 text-xs text-destructive">{item.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentItem({ item }: { readonly item: EnrichQueueItem }) {
  const ok = item.status === "succeeded"
  return (
    <li className="flex items-baseline justify-between gap-2 rounded-md px-1 py-1 text-sm">
      <span className="line-clamp-1 flex-1">{item.title}</span>
      <span
        className={
          ok
            ? "flex shrink-0 items-center gap-1 text-xs text-emerald-600"
            : "flex shrink-0 items-center gap-1 text-xs text-destructive"
        }
      >
        {ok ? (
          <CheckCircle2 aria-hidden="true" className="size-3" />
        ) : (
          <AlertTriangle aria-hidden="true" className="size-3" />
        )}
        {ok ? "成功" : "失敗"}
      </span>
    </li>
  )
}
