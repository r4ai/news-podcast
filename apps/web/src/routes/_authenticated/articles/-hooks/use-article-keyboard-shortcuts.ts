import { useGlobalKeydown } from "@/shared/lib/use-global-keydown"

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

function focusSearchInput() {
  document.getElementById(ARTICLE_SEARCH_INPUT_ID)?.focus()
}

/**
 * キーと配り先の対応表。この画面が受け付けるキーの正本。
 *
 * 「そのキーで何をするか」を、担当がその操作を持っているかどうかと一緒に
 * 1か所へ書く。`/`だけを分岐で先出しすると、受け付けるキーが2か所に散る。
 */
const ARTICLE_SHORTCUTS = {
  j: (handlers) => handlers.onNext,
  k: (handlers) => handlers.onPrev,
  "/": (handlers) =>
    handlers.focusSearchOnSlash ? focusSearchInput : undefined,
  o: (handlers) => handlers.onOpenOriginal,
  s: (handlers) => handlers.onToggleSaved,
  e: (handlers) => handlers.onToggleReadLater,
  u: (handlers) => handlers.onMarkUnread,
} satisfies Record<
  string,
  (handlers: ArticleShortcutHandlers) => (() => void) | undefined
>

/** 利用者へ見せる目録との照合に使う (`shared/lib/keyboard-shortcuts.ts`)。 */
export const ARTICLE_SHORTCUT_KEYS: readonly string[] =
  Object.keys(ARTICLE_SHORTCUTS)

function dispatchShortcut(
  key: string,
  handlers: ArticleShortcutHandlers
): boolean {
  const resolve = ARTICLE_SHORTCUTS[key as keyof typeof ARTICLE_SHORTCUTS]
  const handler = resolve?.(handlers)
  if (!handler) return false
  handler()
  return true
}

/**
 * 記事一覧・リーダー共通のキーボードショートカット (docs要求 §5)。
 * 押せることの周知は`shared/lib/keyboard-shortcuts.ts`の目録が担う。
 */
export function useArticleKeyboardShortcuts(handlers: ArticleShortcutHandlers) {
  useGlobalKeydown((event) => {
    if (dispatchShortcut(event.key, handlers)) {
      // `/`はブラウザのクイック検索を開く。検索欄へ移した以上、そちらは止める。
      if (event.key === "/") event.preventDefault()
    }
  })
}
