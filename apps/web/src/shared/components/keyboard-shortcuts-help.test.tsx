import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { KeyboardShortcutsHelp } from "./keyboard-shortcuts-help"

describe("KeyboardShortcutsHelp", () => {
  it("見えるボタンから開ける。`?`を知らない人にも届く", async () => {
    const user = userEvent.setup()
    render(<KeyboardShortcutsHelp />)

    await user.click(
      screen.getByRole("button", { name: /キーボード操作の一覧/ })
    )

    expect(
      await screen.findByRole("dialog", { name: "キーボード操作" })
    ).toBeDefined()
    expect(screen.getByText("次の記事へ")).toBeDefined()
  })

  it("`?`で開き、Escapeで閉じる", async () => {
    const user = userEvent.setup()
    render(<KeyboardShortcutsHelp />)

    await user.keyboard("?")
    expect(
      await screen.findByRole("dialog", { name: "キーボード操作" })
    ).toBeDefined()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("文字を打っている間は開かない。`?`を打てなくしない", async () => {
    const user = userEvent.setup()
    render(
      <>
        <input aria-label="検索" />
        <KeyboardShortcutsHelp />
      </>
    )

    await user.click(screen.getByRole("textbox", { name: "検索" }))
    await user.keyboard("?")

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("textbox", { name: "検索" })).toHaveProperty(
      "value",
      "?"
    )
  })
})
