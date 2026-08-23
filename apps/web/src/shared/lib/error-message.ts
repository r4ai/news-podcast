/**
 * 取得・更新の失敗を、利用者が次に何をすればよいか判る一文にする。
 *
 * 失敗の中身は2種類あり、どちらもそのまま出せない。
 *
 * - 回線断はブラウザが`TypeError: Failed to fetch`を投げる。英語で、しかも
 *   原因が手元にあることを言わない。
 * - APIはRFC 9457のProblem Detailsを返す。`title`と`detail`は運用のための
 *   文言で、利用者向けの言葉ではない。
 *
 * どちらも「何が起きたか」より「次に何ができるか」へ寄せて言い換える。
 * 原因の追跡はtelemetryが持つので、画面へ技術的な文言を出す必要はない。
 */

const FALLBACK = "データを取得できませんでした"

/** 回線が切れている・サーバへ届かない。取得は始まってすらいない。 */
const OFFLINE = "ネットワークに接続できませんでした。接続を確認してください。"

/**
 * HTTPの状態から言い換える。載っていない状態は最後の一文へ落とす。
 * 401は`shared/api/client.ts`がログインへ送るので、ここへは基本届かない。
 */
const BY_STATUS: Readonly<Record<number, string>> = {
  400: "送信した内容を受け付けられませんでした。",
  401: "ログインの有効期限が切れました。",
  403: "この操作は許可されていません。",
  404: "対象が見つかりませんでした。",
  409: "他の操作と競合しました。少し待ってからやり直してください。",
  422: "送信した内容を受け付けられませんでした。",
  429: "操作が集中しています。少し待ってからやり直してください。",
}

const SERVER = "サーバが応答できませんでした。時間をおいてやり直してください。"

/** `fetch`が拒否するのは回線側の失敗だけで、そのときは必ず`TypeError`。 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError
}

/** Problem Detailsは`throw`された素のobjectで届く。`Error`ではない。 */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const status = (error as { readonly status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

export function describeError(error: unknown): string {
  if (isNetworkFailure(error)) return OFFLINE

  const status = statusOf(error)
  if (status !== undefined) {
    return BY_STATUS[status] ?? (status >= 500 ? SERVER : FALLBACK)
  }
  return FALLBACK
}
