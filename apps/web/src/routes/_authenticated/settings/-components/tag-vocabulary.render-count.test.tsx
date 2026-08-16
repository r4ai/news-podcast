import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  TestProviders,
  createTestQueryClient,
  stubFetch,
} from "@/shared/test/render"
import {
  renderCount,
  resetRenderCounts,
  waitForRenderQuiescence,
} from "@/shared/test/render-count"
import { TagVocabularyManager } from "./tag-vocabulary-manager"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// 登録済みのチップを実物のまま包んで数える。
vi.mock("./tag-chip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tag-chip")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return { ...actual, TagChip: watchRenders("TagChip", actual.TagChip) }
})

const TAG_COUNT = 20

const tags = Array.from({ length: TAG_COUNT }, (_, index) => ({
  id: `tag-${index}`,
  name: `タグ${index}`,
  createdAt: "2026-08-12T00:00:00.000Z",
}))

describe("タグ語彙の描画範囲", () => {
  beforeEach(() => resetRenderCounts())

  /**
   * 新しいタグ名を打つ間、登録済みのチップは1件も変わらない。値をatomに
   * 置いてあるので、購読しているのは入力欄と「追加」ボタンだけのはず。
   * 一覧を全幅で見せる設計にした分、ここが崩れた時の代償は大きくなった。
   */
  it("追加フォームへの打鍵で登録済みのタグを描き直さない", async () => {
    const user = userEvent.setup()
    stubFetch([
      { path: "/v1/me/tags", body: { items: tags } },
      { path: "/v1/me/tag-suggestions", body: { items: [] } },
    ])
    render(
      <TestProviders queryClient={createTestQueryClient()}>
        <TagVocabularyManager />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("タグ0")).toBeDefined())
    await waitForRenderQuiescence(waitFor, "TagChip")

    const afterMount = renderCount("TagChip")
    expect(afterMount).toBeGreaterThanOrEqual(TAG_COUNT)

    await user.type(
      screen.getByRole("textbox", { name: "新しいタグ名" }),
      "セキュリティ"
    )

    const chipRenders = renderCount("TagChip") - afterMount
    expect(
      chipRenders,
      `7打鍵で登録済みのタグが${chipRenders}回描き直された`
    ).toBe(0)
  })
})
