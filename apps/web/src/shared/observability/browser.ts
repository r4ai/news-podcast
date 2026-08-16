import { installPreInitErrorLog } from "./pre-init-errors"
import { installPreInitFetchLog } from "./pre-init-fetch"
import { telemetryEnabled } from "./preference"

/**
 * OTelのweb SDKは圧縮後でも40 kB強あり、同期importするとentry chunkに乗って
 * 最初のフレームを遅らせる。初回描画の後ろへ回し、それまでのfetchとエラーは
 * `pre-init-*`が預かる (ADR-0025のトレース保証を保つため)。
 *
 * 同期で置くのは「後から取り返せないもの」だけ。`traceparent`の注入とエラーの
 * 購読がそれにあたる。
 */
const START_DELAY_MS = 2_000
/** 読み込みに失敗しても1度は取り直す。取れなければ預かった分は捨てる。 */
const IMPORT_RETRY_DELAY_MS = 5_000

function whenIdle(run: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: START_DELAY_MS })
    return
  }
  setTimeout(run, START_DELAY_MS)
}

export function startBrowserObservability(): void {
  if (
    import.meta.env.VITE_TELEMETRY_ENABLED === "false" ||
    !telemetryEnabled()
  ) {
    return
  }

  const preInit = {
    fetches: installPreInitFetchLog(),
    errors: installPreInitErrorLog(),
  }

  // 一度でも失敗すると以降の観測が丸ごと止まるので、取り直す機会を1度作る。
  const load = (attempt: number) => {
    void import("./otel")
      .then(({ start }) => start(preInit))
      .catch(() => {
        if (attempt > 0) return
        setTimeout(() => load(attempt + 1), IMPORT_RETRY_DELAY_MS)
      })
  }

  whenIdle(() => load(0))
}
