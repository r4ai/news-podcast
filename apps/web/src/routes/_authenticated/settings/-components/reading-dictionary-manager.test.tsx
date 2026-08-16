import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Provider, createStore } from "jotai"
import { describe, expect, it, vi } from "vitest"

import {
  ReadingDictionaryManagerView,
  type ReadingDictionaryEntry,
  type ReadingDictionaryManagerViewProps,
} from "./reading-dictionary-manager"

const entry = (
  surface: string,
  reading: string,
  source: ReadingDictionaryEntry["source"],
  createdAt: string
): ReadingDictionaryEntry => ({
  id: surface,
  surface,
  reading,
  accentType: 0,
  source,
  createdAt,
})

const entries = [
  entry("Durable Objects", "デュラブルオブジェクツ", "ai_auto", "2026-08-10"),
  entry("GPT-5", "ジーピーティーファイブ", "manual", "2026-08-03"),
]

function renderManager(
  overrides: Partial<ReadingDictionaryManagerViewProps> = {}
) {
  const props: ReadingDictionaryManagerViewProps = {
    addEntry: vi.fn(),
    deleteEntry: vi.fn(),
    entries,
    isLoading: false,
    pending: false,
    updateEntry: vi.fn(),
    ...overrides,
  }
  // 行ごとの編集下書きはmodule scopeの`atomFamily`が持つ。storeを分けないと
  // 前のテストで開いた編集欄が次のテストへ持ち越され、行の操作ボタンが消える。
  render(
    <Provider store={createStore()}>
      <ReadingDictionaryManagerView {...props} />
    </Provider>
  )
  return props
}

describe("ReadingDictionaryManagerView", () => {
  /**
   * 表記も読みも省略しない。モバイル幅では「Durabl…」「ngi…」まで潰れており、
   * どの語の登録なのかが画面から読み取れなかった。
   */
  it("renders surfaces and readings without truncation classes", () => {
    renderManager()

    for (const text of ["Durable Objects", "デュラブルオブジェクツ"]) {
      const element = screen.getByText(text)
      expect(element.className).not.toContain("truncate")
      expect(element.className).not.toContain("line-clamp")
    }
  })

  it("filters the registered entries by surface or reading", async () => {
    const user = userEvent.setup()
    renderManager()

    await user.type(
      screen.getByRole("searchbox", { name: "登録済みの読みを絞り込む" }),
      "ジーピー"
    )

    expect(screen.getByText("GPT-5")).toBeTruthy()
    expect(screen.queryByText("Durable Objects")).toBeNull()
  })

  /** AIが勝手に入れたものだけを見直したい、が実際にいちばん多い用事。 */
  it("narrows the list down to what the AI added on its own", async () => {
    const user = userEvent.setup()
    renderManager()

    await user.click(screen.getByRole("button", { name: "AI自動" }))

    expect(screen.getByText("Durable Objects")).toBeTruthy()
    expect(screen.queryByText("GPT-5")).toBeNull()
  })

  it("explains an empty filter result instead of showing a blank list", async () => {
    const user = userEvent.setup()
    renderManager()

    await user.type(
      screen.getByRole("searchbox", { name: "登録済みの読みを絞り込む" }),
      "存在しない語"
    )

    expect(screen.getByText(/一致する登録はありません/)).toBeTruthy()
  })

  it("hides the toolbar and explains the empty dictionary", () => {
    renderManager({ entries: [] })

    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.getByText(/読み辞書がまだありません/)).toBeTruthy()
  })

  it("shows a busy placeholder while loading", () => {
    renderManager({ entries: [], isLoading: true })

    expect(
      screen.getByRole("status", { name: "読み辞書を読み込み中" })
    ).toBeTruthy()
    expect(screen.queryByText(/読み辞書がまだありません/)).toBeNull()
  })

  it("names the row editors after the entry they belong to", async () => {
    const user = userEvent.setup()
    renderManager()

    await user.click(screen.getByRole("button", { name: "「GPT-5」を編集" }))

    expect(
      screen.getByRole("textbox", { name: "「GPT-5」の表記" })
    ).toBeTruthy()
    expect(
      screen.getByRole("textbox", { name: "「GPT-5」の読み" })
    ).toBeTruthy()
  })

  /**
   * 読みは全角カタカナしか契約 (`packages/protocols`の`reading`) が通さない。
   * 編集にも同じ規則を当てないと、直したつもりの行が保存時に落ちる。
   */
  it("blocks a row edit that the wire contract would reject", async () => {
    const user = userEvent.setup()
    const { updateEntry } = renderManager()

    await user.click(screen.getByRole("button", { name: "「GPT-5」を編集" }))
    const reading = screen.getByRole("textbox", { name: "「GPT-5」の読み" })
    await user.clear(reading)
    await user.type(reading, "GPT5")

    const save = screen.getByRole("button", { name: "保存" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/全角カタカナで入力してください/)).toBeTruthy()
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it("confirms before deleting a reading", async () => {
    const user = userEvent.setup()
    const { deleteEntry } = renderManager()

    await user.click(screen.getByRole("button", { name: "「GPT-5」を削除" }))
    expect(deleteEntry).not.toHaveBeenCalled()

    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/ジーピーティーファイブ/)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "削除" }))
    expect(deleteEntry).toHaveBeenCalledWith("GPT-5")
  })
})
