import { useSyncExternalStore } from "react"

/**
 * 回線が繋がっているか。
 *
 * 正本はブラウザ (`navigator.onLine`) にあり、stateへ写さずそのまま読む。
 * 写すと、購読を張る前に切れた場合や、別の経路で復帰した場合に食い違う。
 *
 * `navigator.onLine`が言えるのは「この端末がネットワークに繋がっているか」
 * までで、APIに届くかどうかまでは判らない。断定できるのは`false`のとき
 * (=絶対に届かない) だけなので、案内もそちら側にだけ出す。
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

/** サーバ描画・非対応環境では繋がっている前提に倒す。 */
function getServerSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
