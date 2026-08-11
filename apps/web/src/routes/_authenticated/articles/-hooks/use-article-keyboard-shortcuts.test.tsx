import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  ARTICLE_SEARCH_INPUT_ID,
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
