import { WifiOff } from "lucide-react"

import { useOnlineStatus } from "@/shared/lib/use-online-status"

/**
 * 回線が切れていることだけを伝える帯。
 *
 * 切れている間、取得は軒並み失敗する。パネルごとの「表示できませんでした」は
 * どれも同じ顔をしていて、原因が手元にあることを言わない。再試行を何度押しても
 * 変わらないので、先に理由を1か所で言う。
 *
 * 復帰したら消えるだけにする。TanStack Queryが繋がり直しに合わせて取り直すので
 * (`refetchOnReconnect`)、利用者が押す操作は要らない。
 *
 * `role="status"`は控えめな通知。読み上げは操作を遮らず、区切りのよいところで
 * 読まれる。
 */
export function OfflineNotice() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <p
      className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-200"
      role="status"
    >
      <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
      オフラインです。接続が戻ると自動で読み込み直します。
    </p>
  )
}
