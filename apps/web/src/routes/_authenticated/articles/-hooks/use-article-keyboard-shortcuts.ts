import { useEffect, useEffectEvent } from "react"

export const ARTICLE_SEARCH_INPUT_ID = "article-search"

/**
 * 記事を開いている時だけ意味を持つ操作 (o/s/e/u) と、一覧の操作 (j/k//) は
 * 別の担当が登録する。ハンドラが無いキーは素通しし、ブラウザ既定を邪魔しない。
 */
export type ArticleShortcutHandlers = {
  readonly onNext?: () => void
  readonly onPrev?: () => void
  readonly onOpenOriginal?: () => void
  readonly onToggleSaved?: () => void
  readonly onToggleReadLater?: () => void
  readonly onMarkUnread?: () => void
  /** `/`で検索欄へ飛ばすかどうか。一覧側だけがtrueにする。 */
  readonly focusSearchOnSlash?: boolean
}

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

function focusSearchInput() {
  document.getElementById(ARTICLE_SEARCH_INPUT_ID)?.focus()
}

function dispatchShortcut(
  key: string,
  handlers: ArticleShortcutHandlers
): boolean {
  if (key === "/") {
    if (!handlers.focusSearchOnSlash) return false
    focusSearchInput()
    return true
  }
  const handler = {
    j: handlers.onNext,
    k: handlers.onPrev,
    o: handlers.onOpenOriginal,
    s: handlers.onToggleSaved,
    e: handlers.onToggleReadLater,
    u: handlers.onMarkUnread,
  }[key]
  if (!handler) return false
  handler()
  return true
}

/** 記事一覧・リーダー共通のキーボードショートカット (docs要求 §5)。 */
export function useArticleKeyboardShortcuts(handlers: ArticleShortcutHandlers) {
  // リスナーはmount時に1回だけ張る。押された時に最新のhandlerを見たいだけなので、
  // Effectの依存には載せず、useEffectEventで非リアクティブに橋渡しする。
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (dispatchShortcut(event.key, handlers)) {
      if (event.key === "/") event.preventDefault()
    }
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      onShortcut(event)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
