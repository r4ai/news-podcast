import { useEffect, useRef } from "react"

export const ARTICLE_SEARCH_INPUT_ID = "article-search"

export type ArticleShortcutHandlers = {
  readonly onNext: () => void
  readonly onPrev: () => void
  readonly onOpenOriginal: () => void
  readonly onToggleSaved: () => void
  readonly onToggleReadLater: () => void
  readonly onMarkUnread: () => void
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
  switch (key) {
    case "j":
      handlers.onNext()
      return true
    case "k":
      handlers.onPrev()
      return true
    case "o":
      handlers.onOpenOriginal()
      return true
    case "s":
      handlers.onToggleSaved()
      return true
    case "e":
      handlers.onToggleReadLater()
      return true
    case "u":
      handlers.onMarkUnread()
      return true
    case "/":
      focusSearchInput()
      return true
    default:
      return false
  }
}

/** 記事一覧・リーダー共通のキーボードショートカット (docs要求 §5)。 */
export function useArticleKeyboardShortcuts(handlers: ArticleShortcutHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (dispatchShortcut(event.key, handlersRef.current)) {
        if (event.key === "/") event.preventDefault()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
