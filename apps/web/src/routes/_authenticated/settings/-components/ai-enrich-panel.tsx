import { Bot } from "lucide-react"

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
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"

import { useAiEnrichPanel } from "../-hooks/use-ai-enrich-panel"
import { SettingsSection } from "./settings-section"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function AiEnrichPanel() {
  const panel = useAiEnrichPanel()
  return (
    <AiEnrichPanelView
      cancelReprocess={panel.cancelReprocess}
      confirmOpen={panel.confirmOpen}
      confirmReprocess={panel.confirmReprocess}
      daily={panel.daily}
      pending={panel.pending}
      reprocessableCount={panel.reprocessableCount}
      requestReprocess={panel.requestReprocess}
      resetDaily={panel.resetDaily}
    />
  )
}

export type AiEnrichPanelViewProps = {
  readonly daily: { readonly used: number; readonly limit: number } | undefined
  readonly reprocessableCount: number | undefined
  readonly pending: boolean
  readonly confirmOpen: boolean
  readonly requestReprocess: () => void
  readonly cancelReprocess: () => void
  readonly confirmReprocess: () => void
  readonly resetDaily: () => void
}

const counter = new Intl.NumberFormat("ja-JP")

export function AiEnrichPanelView({
  daily,
  reprocessableCount,
  pending,
  confirmOpen,
  requestReprocess,
  cancelReprocess,
  confirmReprocess,
  resetDaily,
}: AiEnrichPanelViewProps) {
  const remaining = daily ? Math.max(0, daily.limit - daily.used) : undefined
  const nothingToReprocess = reprocessableCount === 0

  return (
    <SettingsSection
      description="新着記事の要約・適合度スコア・タグ付与は自動で行われます。既に処理済みの記事を再計算するには、ここから明示的に実行してください。"
      footer={
        <Button
          disabled={pending || nothingToReprocess}
          onClick={requestReprocess}
          variant="outline"
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending
            ? "キューに追加中…"
            : reprocessableCount !== undefined
              ? `全記事を再処理（${counter.format(reprocessableCount)}件）`
              : "全記事を再処理"}
        </Button>
      }
      icon={Bot}
      title="AI処理"
    >
      {/*
        `value`と`max`は素の件数のまま渡す。百分率へ丸めてから渡すと
        `aria-valuenow`が「34%」になり、読み上げが実際の件数から離れる。
      */}
      <Progress
        getAriaValueText={(_, value) =>
          daily
            ? `${counter.format(value ?? 0)}件 / ${counter.format(daily.limit)}件`
            : "読み込み中"
        }
        max={daily?.limit ?? 100}
        value={daily?.used ?? null}
      >
        <ProgressLabel>本日の処理上限</ProgressLabel>
        <ProgressValue>
          {(_, value) =>
            daily
              ? `${counter.format(value ?? 0)} / ${counter.format(daily.limit)}件`
              : "—"
          }
        </ProgressValue>
      </Progress>

      <p className="text-sm text-muted-foreground">
        {remaining === undefined
          ? "使用量を読み込んでいます。"
          : nothingToReprocess
            ? `本日はあと${counter.format(remaining)}件処理できます。再処理できる処理済み記事はありません。`
            : `本日はあと${counter.format(remaining)}件処理できます。上限を超えた分は翌日へ繰り越して処理されます。`}
      </p>

      {import.meta.env.DEV ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            開発用：日次上限をリセット
          </span>
          <Button onClick={resetDaily} size="sm" variant="outline">
            リセット
          </Button>
        </div>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => (!open ? cancelReprocess() : undefined)}
        open={confirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>全記事を再処理しますか</AlertDialogTitle>
            <AlertDialogDescription>
              既に処理済みの{counter.format(reprocessableCount ?? 0)}
              件を再処理キューへ追加します。
              本日の処理上限に従って日をまたいで処理され、コストが発生します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelReprocess}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmReprocess}>
              再処理を開始
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
