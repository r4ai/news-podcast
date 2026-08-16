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
import { ReadingDictionaryManager } from "./reading-dictionary-manager"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// 登録済みの行を実物のまま包んで数える。
vi.mock("@workspace/ui/components/badge", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/ui/components/badge")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return { ...actual, Badge: watchRenders("DictionaryRowBadge", actual.Badge) }
})

const ENTRY_COUNT = 20

const entries = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
  id: `entry-${index}`,
  surface: `表記${index}`,
  reading: `ヨミ${index}`,
  accentType: 0,
  source: "manual" as const,
  createdAt: "2026-08-12T00:00:00.000Z",
}))

describe("読み辞書の描画範囲", () => {
  beforeEach(() => resetRenderCounts())

  /**
   * 新規追加フォームへの打鍵は、その入力欄と「追加」ボタンだけを描き直せば
   * 足りる。登録済みの一覧は1件も変わらないので、行が描き直された回数が
   * そのまま無駄な仕事の量になる。
   */
  it("追加フォームへの打鍵で登録済みの行を描き直さない", async () => {
    const user = userEvent.setup()
    stubFetch([{ path: "/v1/me/reading-dictionary", body: { items: entries } }])
    render(
      <TestProviders queryClient={createTestQueryClient()}>
        <ReadingDictionaryManager />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("表記0")).toBeDefined())
    await waitForRenderQuiescence(waitFor, "DictionaryRowBadge")

    const rowsAfterMount = renderCount("DictionaryRowBadge")
    expect(rowsAfterMount).toBeGreaterThanOrEqual(ENTRY_COUNT)

    await user.type(
      screen.getByRole("textbox", { name: "表記（漢字・英字）" }),
      "GPT-5"
    )
    await user.type(
      screen.getByRole("textbox", { name: "読み（カタカナ）" }),
      "ジーピーティー"
    )

    const rowRenders = renderCount("DictionaryRowBadge") - rowsAfterMount
    expect(
      rowRenders,
      `12打鍵で登録済みの行が${rowRenders}回描き直された`
    ).toBe(0)
  })
})
