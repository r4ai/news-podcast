import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Progress } from "@workspace/ui/components/progress"

import type { EnrichQueueItem, EnrichQueueStatus } from "@/features/enrich/queue"
import type { EnrichQueueDialogState } from "../-hooks/use-enrich-queue"

export type EnrichQueueDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly status: EnrichQueueDialogState["status"]
  readonly connected: boolean
}

/** クリックで開くAI補助キュー状態。処理中/待ち/失敗/本日の上限を一覧する。 */
export function EnrichQueueDialog({
  open,
  onOpenChange,
  status,
  connected,
}: EnrichQueueDialogProps) {
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
              <RefreshCw aria-label="ポーリング中" className="size-3 animate-spin text-muted-foreground" />
            )}
          </DialogTitle>
        </DialogHeader>

        <DailyBudget daily={status?.daily} />

        <QueueSection
          icon={<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
          label="処理中"
          items={status?.processing ?? []}
          showStatus={false}
        />

        <QueueSection
          icon={<RefreshCw aria-hidden="true" className="size-3.5 text-muted-foreground" />}
          label={`待ち ${status?.pending.count ?? 0}件`}
          items={status?.pending.items ?? []}
          showStatus={true}
        />

        <QueueSection
          icon={<AlertTriangle aria-hidden="true" className="size-3.5 text-destructive" />}
          label={`失敗 ${status?.failed.count ?? 0}件`}
          items={status?.failed.items ?? []}
          showStatus={false}
          failure
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
        <span>本日の処理上限</span>
        <span className="tabular-nums">
          {daily.used} / {daily.limit}件
        </span>
      </div>
      <Progress aria-label="本日の処理上限の使用率" value={percent} />
      {daily.used >= daily.limit ? (
        <p className="text-xs text-destructive">
          本日の上限に達しています。明日のバッチで再開されます。
        </p>
      ) : null}
    </div>
  )
}

function QueueSection({
  icon,
  label,
  items,
  showStatus,
  failure = false,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly items: readonly EnrichQueueItem[]
  readonly showStatus: boolean
  readonly failure?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </h3>
      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">ありません</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {items.map((item) => (
            <li
              className="flex items-baseline justify-between gap-2 rounded-md px-1 py-1 text-sm"
              key={item.feedItemId}
            >
              <span className="line-clamp-1 flex-1">{item.title}</span>
              {showStatus ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.status === "failed" ? "再試行待ち" : "待ち"}
                </span>
              ) : null}
              {failure && item.error ? (
                <span className="line-clamp-1 shrink-0 max-w-[40%] text-xs text-destructive">
                  {item.error}
                </span>
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
