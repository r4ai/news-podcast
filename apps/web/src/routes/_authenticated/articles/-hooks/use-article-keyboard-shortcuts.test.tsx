import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SHORTCUT_GROUPS } from "@/shared/lib/keyboard-shortcuts"
import {
  ARTICLE_SEARCH_INPUT_ID,
  ARTICLE_SHORTCUT_KEYS,
  useArticleKeyboardShortcuts,
  type ArticleShortcutHandlers,
} from "./use-article-keyboard-shortcuts"

function Harness({ handlers }: { readonly handlers: ArticleShortcutHandlers }) {
  useArticleKeyboardShortcuts(handlers)
  return (
    <div>
      <input aria-label="記事を検索" id={ARTICLE_SEARCH_INPUT_ID} />
      <textarea aria-label="メモ" />
    </div>
  )
}

function makeHandlers(): ArticleShortcutHandlers {
  return {
    focusSearchOnSlash: true,
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onOpenOriginal: vi.fn(),
    onToggleSaved: vi.fn(),
    onToggleReadLater: vi.fn(),
    onMarkUnread: vi.fn(),
  }
}

describe("useArticleKeyboardShortcuts", () => {
  it("dispatches j/k/o/s/e/u to the matching handler", () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "k" })
    fireEvent.keyDown(window, { key: "o" })
    fireEvent.keyDown(window, { key: "s" })
    fireEvent.keyDown(window, { key: "e" })
    fireEvent.keyDown(window, { key: "u" })

    expect(handlers.onNext).toHaveBeenCalledTimes(1)
    expect(handlers.onPrev).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenOriginal).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleSaved).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleReadLater).toHaveBeenCalledTimes(1)
    expect(handlers.onMarkUnread).toHaveBeenCalledTimes(1)
  })

  it("focuses the search input on /", () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    fireEvent.keyDown(window, { key: "/" })

    expect(document.activeElement?.id).toBe(ARTICLE_SEARCH_INPUT_ID)
  })

  it("does not fire shortcuts while an input is focused", () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    const input = document.getElementById(ARTICLE_SEARCH_INPUT_ID)!
    input.focus()
    fireEvent.keyDown(input, { key: "j" })

    expect(handlers.onNext).not.toHaveBeenCalled()
  })

  it("does not fire shortcuts while a textarea is focused", () => {
    const handlers = makeHandlers()
    const { container } = render(<Harness handlers={handlers} />)

    const textarea = container.querySelector("textarea")!
    textarea.focus()
    fireEvent.keyDown(textarea, { key: "s" })

    expect(handlers.onToggleSaved).not.toHaveBeenCalled()
  })

  it("ignores shortcuts combined with modifier keys", () => {
    const handlers = makeHandlers()
    render(<Harness handlers={handlers} />)

    fireEvent.keyDown(window, { key: "j", metaKey: true })

    expect(handlers.onNext).not.toHaveBeenCalled()
  })
})

describe("利用者へ見せる目録との一致", () => {
  /**
   * 目録は「押せること」を伝える唯一の場所なので、実装からずれると
   * 「書いてあるのに効かない」「効くのに載っていない」が生まれる。
   */
  it("記事の項目は、実際に配っているキーと過不足なく一致する", () => {
    const listed = SHORTCUT_GROUPS.find(
      (group) => group.title === "記事"
    )?.shortcuts.flatMap((shortcut) => shortcut.keys)

    expect(listed?.toSorted()).toEqual([...ARTICLE_SHORTCUT_KEYS].toSorted())
  })
})

describe("modalが開いている間", () => {
  /**
   * modalの裏のページはその時点で操作の対象ではない。素通しすると`j`が裏の
   * 選択を動かし、`/`は閉じ込めたはずのfocusを裏の検索欄へ連れ出す。
   */
  it("裏の一覧の操作へ届かせない", () => {
    const handlers = makeHandlers()
    render(
      <>
        <Harness handlers={handlers} />
        <div aria-modal="true" data-testid="modal" role="dialog" tabIndex={-1}>
          <p>AI処理キュー</p>
        </div>
      </>
    )

    const modal = screen.getByTestId("modal")
    fireEvent.keyDown(modal, { key: "j" })
    fireEvent.keyDown(modal, { key: "o" })
    fireEvent.keyDown(modal, { key: "/" })

    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onOpenOriginal).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(
      document.getElementById(ARTICLE_SEARCH_INPUT_ID)
    )
  })
})
