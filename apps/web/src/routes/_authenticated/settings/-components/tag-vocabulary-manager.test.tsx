import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  TagVocabularyManagerView,
  type TagVocabularyManagerViewProps,
} from "./tag-vocabulary-manager"

function suggestions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `候補${index + 1}`,
    occurrences: count - index,
    lastSeenAt: "2026-08-12T00:00:00.000Z",
  }))
}

function tags(names: readonly string[]) {
  return names.map((name, index) => ({
    id: `tag-${index}`,
    name,
    createdAt: "2026-08-12T00:00:00.000Z",
  }))
}

function renderManager(overrides: Partial<TagVocabularyManagerViewProps> = {}) {
  const props: TagVocabularyManagerViewProps = {
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    isLoading: false,
    pending: false,
    promoteSuggestion: vi.fn(),
    suggestions: suggestions(3),
    tags: tags(["AI"]),
    ...overrides,
  }
  render(<TagVocabularyManagerView {...props} />)
  return props
}

describe("TagVocabularyManagerView", () => {
  /**
   * タグを消すと記事側の付与も一緒に消える (FKのON DELETE CASCADE)。
   * 取り消せない操作なので、×を押しただけでは消えない。
   */
  it("confirms before deleting a tag, and never deletes from the chip itself", async () => {
    const user = userEvent.setup()
    const { deleteTag } = renderManager()

    await user.click(screen.getByText("AI"))
    expect(deleteTag).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "タグ「AI」を削除" }))
    expect(deleteTag).not.toHaveBeenCalled()

    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/記事からも外れ/)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "削除" }))
    expect(deleteTag).toHaveBeenCalledWith("tag-0")
  })

  it("keeps the tag when the confirmation is dismissed", async () => {
    const user = userEvent.setup()
    const { deleteTag } = renderManager()

    await user.click(screen.getByRole("button", { name: "タグ「AI」を削除" }))
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "キャンセル",
      })
    )

    expect(deleteTag).not.toHaveBeenCalled()
  })

  /**
   * 提案は畳まない。語彙とは別の枠で扱うので縦に伸びても語彙を押し下げず、
   * 「あと何件残っているか」がそのまま見える方が捌きやすい。
   */
  it("lists every suggestion with the numbers needed to judge it", () => {
    renderManager({ suggestions: suggestions(30) })

    expect(screen.getByText("候補30")).toBeTruthy()
    expect(screen.getAllByText(/回 ・ 最終/)).toHaveLength(30)
  })

  it("filters the vocabulary once it outgrows a glance", async () => {
    const user = userEvent.setup()
    renderManager({
      tags: tags([
        "生成AI",
        "フロントエンド",
        "TypeScript",
        "データベース",
        "セキュリティ",
        "インフラ",
        "設計",
        "パフォーマンス",
        "モバイル",
      ]),
    })

    await user.type(
      screen.getByRole("searchbox", { name: "登録済みのタグを絞り込む" }),
      "セキュ"
    )

    expect(screen.getByText("セキュリティ")).toBeTruthy()
    expect(screen.queryByText("生成AI")).toBeNull()
  })

  /** 少ないうちに絞り込み欄を出しても、置き場所を取るだけになる。 */
  it("leaves the filter out while every tag is visible at a glance", () => {
    renderManager({ tags: tags(["AI", "Web"]) })

    expect(screen.queryByRole("searchbox")).toBeNull()
  })

  /** 名前を省略しないことが一覧性の前提。CSSの`truncate`は使わない。 */
  it("never truncates a suggestion or tag name", () => {
    const longName = "エッジコンピューティングとオブザーバビリティ"
    renderManager({
      suggestions: [
        { name: longName, occurrences: 3, lastSeenAt: "2026-08-12" },
      ],
      tags: [{ id: "tag-1", name: longName, createdAt: "2026-08-12" }],
    })

    for (const element of screen.getAllByText(longName)) {
      expect(element.className).not.toContain("truncate")
      expect(element.className).not.toContain("line-clamp")
    }
  })

  it("shows a busy placeholder instead of an empty card while loading", () => {
    renderManager({ isLoading: true, suggestions: [], tags: [] })

    expect(
      screen.getByRole("status", { name: "タグを読み込み中" })
    ).toBeTruthy()
    expect(screen.queryByText(/語彙がまだありません/)).toBeNull()
  })

  it("explains the suggestion panel even when it is empty", () => {
    renderManager({ suggestions: [] })

    expect(screen.getByText(/提案はありません/)).toBeTruthy()
  })
})
