/**
 * トーストの受け口。sonnerの読み込みを最初の1件まで遅らせる。
 *
 * sonnerは圧縮後でも十数kBあり、`Toaster`はアプリの根に常駐する。しかし
 * トーストは操作の結果にしか出ないので、初回表示には1件も要らない。
 *
 * sonnerの`toast()`は購読者がいなければ捨てられるので、`Toaster`が載るまでは
 * ここで預かる。呼び出し側から見た使い勝手は素のsonnerと同じ。
 */
export type ToastKind = "success" | "error" | "info"

export type ToastCall = {
  readonly kind: ToastKind
  readonly message: string
}

const queued: ToastCall[] = []
const wakeups = new Set<() => void>()
let deliver: ((call: ToastCall) => void) | undefined
// 一度でも要求されたら下ろさない。要求の有無ではなく「宿主が要るか」を表す。
let requested = false

function enqueue(call: ToastCall) {
  requested = true
  if (deliver) {
    deliver(call)
    return
  }
  queued.push(call)
  // `Toaster`の受け入れ準備 (=sonnerの読み込みと実装の描画) を促す。
  for (const wake of wakeups) wake()
}

export const toast = {
  success: (message: string) => enqueue({ kind: "success", message }),
  error: (message: string) => enqueue({ kind: "error", message }),
  info: (message: string) => enqueue({ kind: "info", message }),
}

/** トーストが1件でも要求されたら呼ばれる。`Toaster`の宿主が使う。 */
export function onToastRequested(wake: () => void): () => void {
  wakeups.add(wake)
  return () => wakeups.delete(wake)
}

/** 宿主を載せる必要があるか。一度trueになったら戻らない。 */
export function isToastHostNeeded(): boolean {
  return requested
}

/** sonnerが載った時点で配送先を繋ぎ、預かっていた分を流す。 */
export function connectToastSink(sink: (call: ToastCall) => void): void {
  deliver = sink
  for (const call of queued.splice(0)) sink(call)
}

/** テスト用。moduleの状態を初期化する。 */
export function resetToastSink(): void {
  deliver = undefined
  requested = false
  queued.length = 0
  wakeups.clear()
}
