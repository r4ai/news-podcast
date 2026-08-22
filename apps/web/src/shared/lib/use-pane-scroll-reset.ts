import { useLayoutEffect, useRef } from "react"

/**
 * 2ペインの詳細側を、開き直すたびに頭から見せる。
 *
 * スクロールしているのは外側の枠で、`key`で差し替わるのは中身だけなので、
 * 位置は前の中身のまま残る。長い本文を読んだ後に隣を開くと、題名も操作列も
 * 画面の外から始まってしまう。
 *
 * 移すのは描き上がったcommitで、paintの前。`useEffect`だと、新しい中身が
 * 前の位置で1フレーム見えてから跳ねる。
 *
 * 1カラムではこの枠がスクロール領域ではないので、書いても何も起きない。
 * 幅で呼び分けなくてよい。
 */
export function usePaneScrollReset(key: string | undefined) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [key])

  return ref
}
