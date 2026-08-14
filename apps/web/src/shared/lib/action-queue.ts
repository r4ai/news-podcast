/**
 * 非同期アクションを投入順に直列化する。
 *
 * 楽観的UIでは、同じ対象への連打が並行すると「最後に投げた要求」と
 * 「最後に返った応答」が一致せず、サーバ応答でUIが巻き戻る。
 * 実行順を投入順へ固定することで、最終状態が常に最後の操作と一致する。
 *
 * 失敗は呼び出し元へ伝えるだけで、キューは止めない。
 */
export type ActionQueue = <T>(action: () => Promise<T>) => Promise<T>

export function createActionQueue(): ActionQueue {
  let tail: Promise<unknown> = Promise.resolve()

  return <T>(action: () => Promise<T>): Promise<T> => {
    // 直前の失敗で鎖が切れないよう、待つ側は結果を捨てる。
    const run = tail.then(action, action)
    tail = run.catch(() => undefined)
    return run
  }
}
