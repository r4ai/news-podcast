import { useCallback, useSyncExternalStore } from "react"

/**
 * 画面幅などの条件に合っているか。
 *
 * 正本はブラウザ (`matchMedia`) にあり、stateへ写さずそのまま読む。写すと、
 * 購読を張る前に回転した場合に食い違う。
 *
 * CSSで済むことはCSSでやる。ここを使ってよいのは、**同じものをDOMの別の
 * 場所へ置き分ける**ときだけ。`display`の切り替えでは、portalへ出す面と
 * その場に開く面のように、木の形そのものが違う2つを選べない。
 */
function listen(query: string, onChange: () => void): () => void {
  const list = window.matchMedia(query)
  list.addEventListener("change", onChange)
  return () => list.removeEventListener("change", onChange)
}

/** 一致しない側に倒す。狭い幅向けの作りは、広い幅でも破綻しない。 */
const SERVER_SNAPSHOT = false

export function useMediaQuery(query: string): boolean {
  // 購読の関数は条件ごとに固定する。毎描画で作り直すと、そのたびに
  // 張り直しになる。
  const subscribe = useCallback(
    (onChange: () => void) => listen(query, onChange),
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => SERVER_SNAPSHOT
  )
}
