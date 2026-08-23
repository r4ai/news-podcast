import { useEffect, useEffectEvent, useRef } from "react"

import { useOnlineStatus } from "./use-online-status"

/**
 * 回線が**戻った瞬間**に一度だけ呼ぶ。
 *
 * 見ているのは状態ではなく遷移 (切れている → 繋がった)。状態で見ると、
 * 最初から繋がっている場合にも走ってしまう。取得失敗の再試行に使うので、
 * それは即座の再試行の繰り返しになる。
 */
export function useReconnect(onReconnect: () => void): void {
  const online = useOnlineStatus()
  // 呼ぶ中身は最新でよいが、依存に載せると回線が変わっていなくても走る。
  const run = useEffectEvent(onReconnect)
  // 「切れていた」を跨いで覚える。繋がった状態で始まったなら、まだ何も
  // 失っていないので戻る出来事も無い。
  const wasOffline = useRef(!online)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    run()
  }, [online])
}
