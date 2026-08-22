import { useEffect, useEffectEvent } from "react"

/** 入力欄・テキストエリア・contentEditableへフォーカス中は発火させない。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  )
}

/**
 * modalの中で押されたか。
 *
 * modalが開いている間、その裏のページは操作の対象ではない。素通しすると、
 * `j`が裏の一覧の選択を動かし、`o`が別のタブを開き、`/`に至っては閉じ込めた
 * はずのfocusを裏の検索欄へ連れ出す。modalを閉じる操作 (Escape) は
 * dialog自身が持っているので、ここは黙って見送ればよい。
 */
function isInsideModal(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("[aria-modal=true]") !== null
  )
}

/**
 * 画面全体で1打鍵を受ける。
 *
 * 素通しする条件は1か所に集める。修飾キー付きはブラウザやOSの操作なので
 * 奪わない。文字を打っている最中も同じで、`j`が「次の記事へ」になると
 * 検索欄へ`j`が打てなくなる。modalが開いている間も同じで、裏のページは
 * その時点で操作の対象ではない。
 *
 * リスナーはmount時に1回だけ張る。押された時に最新のhandlerを見たいだけなので、
 * Effectの依存には載せず`useEffectEvent`で非リアクティブに橋渡しする。張り直すと
 * 押しっぱなしの最中に取りこぼす。
 */
export function useGlobalKeydown(onKey: (event: KeyboardEvent) => void): void {
  const handle = useEffectEvent(onKey)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target) || isInsideModal(event.target)) return
      handle(event)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
