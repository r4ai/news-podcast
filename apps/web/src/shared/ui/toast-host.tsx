import { Suspense, lazy, useSyncExternalStore } from "react"

import { isToastHostNeeded, onToastRequested } from "./toast"

const SonnerToaster = lazy(() => import("./sonner-toaster"))

/**
 * トーストの宿主。最初の1件が要求されるまで何も描かず、sonnerも読み込まない。
 *
 * 「要求されたか」はReactの外にあるmodule stateなので、`useSyncExternalStore`
 * で読む。Effectでstateへ写すと1描画分遅れる上、正本が二重になる (ADR-0047)。
 *
 * テーマは`SonnerToaster`が自分で読む。ここで受け取ってしまうと、テーマの
 * 変更がアプリの根を描き直すことになる。
 */
export function ToastHost() {
  const needed = useSyncExternalStore(
    onToastRequested,
    isToastHostNeeded,
    // サーバ側にトーストは存在しない。
    () => false
  )
  if (!needed) return null

  return (
    <Suspense fallback={null}>
      <SonnerToaster />
    </Suspense>
  )
}
