import { CatchBoundary } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { lazy, Suspense } from "react"

import { Button } from "@workspace/ui/components/button"

import { recordBrowserEvent } from "@/shared/observability/events"
import { enrichQueueOpenAtom } from "../-atoms"

const ConnectedEnrichQueueDialog = lazy(async () => {
  const module = await import("./enrich-queue-dialog")
  return { default: module.ConnectedEnrichQueueDialog }
})

/**
 * キューを開くまでは、ダイアログと接続処理を記事routeへ読み込まない。
 *
 * 入口と開閉の正本は軽い同期chunkに残す。利用者が入口を押すとatomが先に
 * `true`になり、この境界がダイアログを読み込む。待っている間も記事一覧は
 * そのまま操作でき、読み込み後にダイアログ側がfocusとSSE購読を引き受ける。
 */
export function EnrichQueueDialogHost() {
  const open = useAtomValue(enrichQueueOpenAtom)
  if (!open) return null

  return (
    <CatchBoundary
      errorComponent={() => <DialogLoadError />}
      getResetKey={() => "enrich-queue-dialog"}
      onCatch={(error) =>
        recordBrowserEvent("panel.error", {
          "panel.name": "enrich-queue-dialog",
          "error.type": error instanceof Error ? error.name : "UnknownError",
        })
      }
    >
      <Suspense fallback={null}>
        <ConnectedEnrichQueueDialog />
      </Suspense>
    </CatchBoundary>
  )
}

function DialogLoadError() {
  return (
    <section
      className="fixed right-4 bottom-[calc(var(--app-nav-h)+var(--player-h)+1rem)] z-50 flex max-w-sm flex-col gap-3 rounded-lg border border-destructive/40 bg-background p-4 shadow-lg md:bottom-[calc(var(--player-h)+1rem)]"
      role="alert"
    >
      <div>
        <h2 className="font-medium">AI処理キューを開けませんでした</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          アプリを再読み込みして、もう一度お試しください。
        </p>
      </div>
      <Button onClick={() => window.location.reload()} size="sm">
        アプリを再読み込み
      </Button>
    </section>
  )
}
