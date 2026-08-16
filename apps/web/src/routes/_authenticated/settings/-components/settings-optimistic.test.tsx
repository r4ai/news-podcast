import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TestProviders, createTestQueryClient } from "@/shared/test/render"
import { ReadingDictionaryManager } from "./reading-dictionary-manager"
import { TagVocabularyManager } from "./tag-vocabulary-manager"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

/**
 * 削除も追加も、応答を待たずに画面へ出す。
 *
 * 待たせると往復2回分 (更新 + 取り直し) の間、消したはずの項目が残り、
 * 押した操作が効いたのかどうか分からない。確定値はサーバ応答のままで、
 * 見せ方だけを先に進める (ADR-0047の`useOptimistic`)。
 */

const tags = [
  { id: "tag-0", name: "AI", createdAt: "2026-08-12T00:00:00.000Z" },
  { id: "tag-1", name: "Rust", createdAt: "2026-08-12T00:00:00.000Z" },
]

const entries = [
  {
    id: "entry-0",
    surface: "GPT-5",
    reading: "ジーピーティーファイブ",
    accentType: 0,
    source: "manual" as const,
    createdAt: "2026-08-12T00:00:00.000Z",
  },
]

/**
 * 変更系だけを保留にするfetch。GETは即答するので一覧は普通に出るが、
 * DELETE/POSTは`release()`を呼ぶまで返らない。「応答前の画面」を見られる。
 */
function stubWithHeldMutations(
  routes: readonly { readonly path: string; readonly body: unknown }[]
) {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url, "http://localhost")
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })

      if (request.method.toUpperCase() !== "GET") {
        await held
        return json({ id: "created", name: "新しいタグ" })
      }
      const route = routes.find((candidate) => candidate.path === url.pathname)
      return route ? json(route.body) : json({ items: [] })
    })
  )

  return { release: () => release() }
}

describe("設定画面の楽観的更新", () => {
  it("タグの削除を、応答を待たずに一覧から消す", async () => {
    const user = userEvent.setup()
    const { release } = stubWithHeldMutations([
      { path: "/v1/me/tags", body: { items: tags } },
      { path: "/v1/me/tag-suggestions", body: { items: [] } },
    ])
    render(
      <TestProviders queryClient={createTestQueryClient()}>
        <TagVocabularyManager />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("AI")).toBeDefined())

    await user.click(screen.getByRole("button", { name: "タグ「AI」を削除" }))
    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "削除" }))

    // DELETEはまだ返っていない。それでもチップは消えている。
    await waitFor(() => expect(screen.queryByText("AI")).toBeNull())
    // 消したのは1件だけ。他の語彙は残る。
    expect(screen.getByText("Rust")).toBeDefined()

    release()
  })

  it("読み辞書の削除を、応答を待たずに一覧から消す", async () => {
    const user = userEvent.setup()
    const { release } = stubWithHeldMutations([
      { path: "/v1/me/reading-dictionary", body: { items: entries } },
    ])
    render(
      <TestProviders queryClient={createTestQueryClient()}>
        <ReadingDictionaryManager />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("GPT-5")).toBeDefined())

    await user.click(screen.getByRole("button", { name: "「GPT-5」を削除" }))
    const dialog = screen.getByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "削除" }))

    await waitFor(() => expect(screen.queryByText("GPT-5")).toBeNull())

    release()
  })

  it("追加したタグを、応答を待たずに一覧へ出す", async () => {
    const user = userEvent.setup()
    const { release } = stubWithHeldMutations([
      { path: "/v1/me/tags", body: { items: tags } },
      { path: "/v1/me/tag-suggestions", body: { items: [] } },
    ])
    render(
      <TestProviders queryClient={createTestQueryClient()}>
        <TagVocabularyManager />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("AI")).toBeDefined())

    await user.type(
      screen.getByRole("textbox", { name: "新しいタグ名" }),
      "TypeScript"
    )
    await user.click(screen.getByRole("button", { name: "追加" }))

    await waitFor(() => expect(screen.getByText("TypeScript")).toBeDefined())

    release()
  })
})
