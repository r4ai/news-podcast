import { useAtomValue } from "jotai"
import { lazy, Suspense } from "react"

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
    <Suspense fallback={null}>
      <ConnectedEnrichQueueDialog />
    </Suspense>
  )
}
