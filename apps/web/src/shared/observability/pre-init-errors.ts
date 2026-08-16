/**
 * SDKが載るまでのブラウザエラーを預かる。
 *
 * `window.error`と`unhandledrejection`の購読は`otel.start`の中にあるので、
 * SDKを遅延読み込みにすると、その間に起きた初期描画の例外が丸ごと消える。
 * 初回描画で落ちる不具合は最も知りたい類のものなので、購読だけを同期で置く。
 *
 * 記録は上限つき。SDKの読み込み自体が失敗しても際限なく溜まることはない。
 */

export type PreInitError = {
  readonly source: string
  readonly errorType: string
  readonly time: number
}

export type PreInitErrorLog = {
  /** 記録を取り出し、以降の記録を止める。SDKが載った時点で1度だけ呼ぶ。 */
  readonly drain: () => readonly PreInitError[]
}

const MAX_RECORDS = 20

export function installPreInitErrorLog(): PreInitErrorLog {
  const records: PreInitError[] = []
  let recording = true

  const record = (source: string, error: unknown) => {
    if (!recording || records.length >= MAX_RECORDS) return
    records.push({
      source,
      errorType: error instanceof Error ? error.name : "UnknownError",
      time: Date.now(),
    })
  }

  const onError = (event: ErrorEvent) => record("window.error", event.error)
  const onRejection = (event: PromiseRejectionEvent) =>
    record("unhandledrejection", event.reason)

  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)

  return {
    drain: () => {
      recording = false
      // 以降はSDKの計装が同じ2つのイベントを購読する。二重に記録しない。
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
      return records.splice(0)
    },
  }
}
