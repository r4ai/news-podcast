import type { SSEStreamingApi } from "hono/streaming"

export const JOB_STREAM_POLL_MS = 500
export const JOB_STREAM_HEARTBEAT_MS = 15_000
/** ジョブ自体の上限30分より長くしておき、正常終了を打ち切らないようにする。 */
export const JOB_STREAM_MAX_MS = 35 * 60_000
/** キュー状態SSEの上限。常時接続は避け、切断・再接続で最新を取れるようにする。 */
export const ENRICH_STREAM_MAX_MS = 30 * 60_000

export interface PollingStreamOptions {
  readonly pollMs: number
  readonly heartbeatMs: number
  readonly maxMs: number
}

/** 1回のポーリングで起きたこと。呼び出し側のループ制御に使う。 */
export interface PollResult {
  /** このtickでクライアントへ書き込んだか（ハートビートのタイマーをリセットする）。 */
  readonly wrote: boolean
  /** ストリームを終了してよいか（例: ジョブが終端状態に達した）。 */
  readonly done: boolean
}

/**
 * 「中断監視 + ポーリング + ハートビート + 上限時間での自動終了」という、
 * enrich-queue/events と episode-jobs/events に共通するSSEループを一元化する。
 * 差分検知・書き込み内容・終端判定はルート固有なので `poll` コールバックに委ねる。
 */
export async function runPollingStream(
  stream: SSEStreamingApi,
  options: PollingStreamOptions,
  poll: () => Promise<PollResult>
): Promise<void> {
  let aborted = false
  stream.onAbort(() => {
    aborted = true
  })
  let lastWriteAt = Date.now()
  const startedAt = Date.now()
  while (!aborted && Date.now() - startedAt < options.maxMs) {
    const result = await poll()
    if (result.done) return
    if (result.wrote) {
      lastWriteAt = Date.now()
    } else if (Date.now() - lastWriteAt >= options.heartbeatMs) {
      await stream.write(": heartbeat\n\n")
      lastWriteAt = Date.now()
    }
    await stream.sleep(options.pollMs)
  }
}
