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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"

import { useAiEnrichPanel } from "../-hooks/use-ai-enrich-panel"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function AiEnrichPanel() {
  const panel = useAiEnrichPanel()
  return (
    <AiEnrichPanelView
      cancelReprocess={panel.cancelReprocess}
      confirmOpen={panel.confirmOpen}
      confirmReprocess={panel.confirmReprocess}
      daily={panel.status?.daily}
      pending={panel.pending}
      reprocessableCount={panel.status?.reprocessable.count}
      requestReprocess={panel.requestReprocess}
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
}

export function AiEnrichPanelView({
  daily,
  reprocessableCount,
  pending,
  confirmOpen,
  requestReprocess,
  cancelReprocess,
  confirmReprocess,
}: AiEnrichPanelViewProps) {
  const percent = daily
    ? Math.min(100, Math.round((daily.used / daily.limit) * 100))
    : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>AI処理</h2>
        </CardTitle>
        <CardDescription>
          新着記事の要約・適合度スコア・タグ付与は自動で行われます。既に処理済みの
          記事を再計算するには、ここから明示的に実行してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>本日の処理上限</span>
            {daily ? (
              <span className="tabular-nums">
                {daily.used} / {daily.limit}件
              </span>
            ) : null}
          </div>
          <Progress aria-label="本日の処理上限の使用率" value={percent ?? null} />
        </div>

        {reprocessableCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            再処理できる処理済み記事はありません。
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={pending || reprocessableCount === 0}
          onClick={requestReprocess}
          variant="outline"
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending
            ? "キューに追加中…"
            : reprocessableCount !== undefined
              ? `全記事を再処理（${reprocessableCount}件）`
              : "全記事を再処理"}
        </Button>
      </CardFooter>

      <AlertDialog
        onOpenChange={(open) => (!open ? cancelReprocess() : undefined)}
        open={confirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>全記事を再処理しますか</AlertDialogTitle>
            <AlertDialogDescription>
              既に処理済みの{reprocessableCount ?? 0}件を再処理キューへ追加します。
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
    </Card>
  )
}
