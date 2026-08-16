import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Provider, createStore } from "jotai"
import { describe, expect, it, vi } from "vitest"

import { articleSearchDraftAtom, displayedSearchQuery } from "../-atoms"
import { ArticleSearchField } from "./article-search-field"

describe("displayedSearchQuery", () => {
  it("下書きが無ければURLの値を出す", () => {
    expect(displayedSearchQuery(null, "otel")).toBe("otel")
  })

  it("同じURL状態から始まった下書きを優先する", () => {
    expect(displayedSearchQuery({ base: "otel", value: "otelx" }, "otel")).toBe(
      "otelx"
    )
  })

  it("URLが外から変わったら下書きを捨てる", () => {
    // 戻る/進むやフィルタのリセット。前の値を覚えるstateは要らない。
    expect(
      displayedSearchQuery({ base: "otel", value: "otelx" }, "react")
    ).toBe("react")
  })
})

describe("ArticleSearchField", () => {
  function renderField(q = "") {
    const store = createStore()
    const onCommit = vi.fn()
    render(
      <Provider store={store}>
        <ArticleSearchField onCommit={onCommit} q={q} />
      </Provider>
    )
    return { store, onCommit }
  }

  it("打鍵はすぐ表示に出るが、URLへの確定はデバウンスされる", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onCommit } = renderField()

    const input = screen.getByRole("textbox", { name: "記事を検索" })
    await user.type(input, "otel")

    expect(input).toHaveProperty("value", "otel")
    expect(onCommit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("otel")
    vi.useRealTimers()
  })

  it("URLの検索語が外から変われば、入力欄はそれに従う", () => {
    const store = createStore()
    store.set(articleSearchDraftAtom, { base: "", value: "打ちかけ" })

    const { rerender } = render(
      <Provider store={store}>
        <ArticleSearchField onCommit={vi.fn()} q="" />
      </Provider>
    )
    expect(screen.getByRole("textbox", { name: "記事を検索" })).toHaveProperty(
      "value",
      "打ちかけ"
    )

    rerender(
      <Provider store={store}>
        <ArticleSearchField onCommit={vi.fn()} q="react" />
      </Provider>
    )
    expect(screen.getByRole("textbox", { name: "記事を検索" })).toHaveProperty(
      "value",
      "react"
    )
  })

  it("消すボタンは入力を空にして確定する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onCommit } = renderField("otel")

    await user.click(screen.getByRole("button", { name: "検索条件を消す" }))
    await vi.advanceTimersByTimeAsync(300)

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("")
    vi.useRealTimers()
  })
})
