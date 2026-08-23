import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { createTestQueryClient, TestProviders } from "@/shared/test/render"
import type { Article } from "../-model"
import { ArticleReaderView } from "./article-reader"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeArticle(): Article {
  return {
    id: "a",
    feedId: "feed-1",
    sourceName: "Zenn",
    title: "記事",
    url: "https://example.com/a",
    discoveredAt: "2026-08-11T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  } as Article
}

/**
 * 目次はリーダーの組み立て(本文の外へ出す器 + `MarkdownToc`)で成立するので、
 * `MarkdownToc`単体ではなくこの層で確かめる。
 */
function renderReader(markdown: string) {
  const noop = () => {}
  const asyncNoop = async () => {}
  return render(
    <TestProviders queryClient={createTestQueryClient()}>
      <ArticleReaderView
        archiveUrl={undefined}
        archiveUnavailable={false}
        article={makeArticle()}
        articleId="a"
        didAutoFallback={false}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        isRecalculating={false}
        markdown={markdown}
        markUnread={noop}
        recalculateAi={asyncNoop}
        retryArchive={asyncNoop}
        setSource={noop}
        source="markdown"
        toggleHidden={noop}
        toggleReadLater={noop}
        toggleSaved={noop}
      />
    </TestProviders>
  )
}

/**
 * 本文はunified + Shikiの動的importを通ってから差し替わる。既定の1秒は
 * テストファイルが並列で走る時のCPU次第で足りず、待ち時間だけが理由で
 * 落ちることがある。待つ対象は変えず、締切だけ他の非同期待ちと揃える。
 */
const PIPELINE_TIMEOUT = { timeout: 5_000 } as const

/**
 * 本文の前に置く、畳める目次の見出し。右のレールにも「目次」を含む操作が
 * あるので、開閉を持つ方 (`aria-expanded`) で選り分ける。
 */
function inBodyTocTrigger(): HTMLElement | undefined {
  return screen
    .getAllByRole("button", { name: /目次/ })
    .find((button) => button.hasAttribute("aria-expanded"))
}

describe("ArticleReaderView table of contents", () => {
  it("shows the toc once the body has enough headings to navigate", async () => {
    renderReader("# 章\n\n本文\n\n# 別の章\n\n本文")

    await waitFor(
      () =>
        expect(
          screen.getAllByRole("navigation", { name: "目次" }).length
        ).toBeGreaterThan(0),
      PIPELINE_TIMEOUT
    )
    // 本文の前に畳んで置く器と、右へ格納できるレール。どちらが見えるかは幅次第。
    expect(inBodyTocTrigger()).toBeDefined()
    expect(
      screen.getByRole("button", { name: "目次を開いて固定する" })
    ).toBeTruthy()
  })

  it("collapses the in-body toc so opening an article does not push the body down", async () => {
    renderReader("# 章\n\n本文\n\n# 別の章\n\n本文")

    const trigger = await waitFor(() => {
      const found = inBodyTocTrigger()
      if (found === undefined) throw new Error("目次はまだ組み上がっていない")
      return found
    }, PIPELINE_TIMEOUT)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })

  it("keeps the rail out of the flow until it is pinned, so the body keeps the width", async () => {
    // 縦に畳んでも空いた1列は空いたまま。畳む方向を横にして、格納中は
    // 本文の並びから外す。
    const { container } = renderReader("# 章\n\n本文\n\n# 別の章\n\n本文")
    const user = userEvent.setup()

    const handle = await waitFor(
      () => screen.getByRole("button", { name: "目次を開いて固定する" }),
      PIPELINE_TIMEOUT
    )
    expect(container.querySelector(".w-60")).toBeNull()

    await user.click(handle)

    const rail = container.querySelector(".w-60")
    expect(rail).not.toBeNull()
    // 追従は器のこの枠が持つ。中身側をstickyにすると、動ける範囲が器の
    // 高さで尽きる。
    expect(rail?.className).toContain("sticky")
    expect(rail?.className).toContain("self-start")
    expect(
      screen.queryByRole("button", { name: "目次を開いて固定する" })
    ).toBeNull()
  })

  it("sends the pinned rail back off-screen from the same place that pinned it", async () => {
    const { container } = renderReader("# 章\n\n本文\n\n# 別の章\n\n本文")
    const user = userEvent.setup()

    await user.click(
      await waitFor(
        () => screen.getByRole("button", { name: "目次を開いて固定する" }),
        PIPELINE_TIMEOUT
      )
    )
    await user.click(
      screen.getByRole("button", { name: "目次を画面外へ格納する" })
    )

    expect(container.querySelector(".w-60")).toBeNull()
    expect(
      screen.getByRole("button", { name: "目次を開いて固定する" })
    ).toBeTruthy()
  })

  it("leaves out the disclosure and the rail when the toc would be empty", async () => {
    // 見出しが1つだけの記事では目次が何も描かない。器だけ残すと、空の
    // 「目次」と幅だけ取るレールが本文を狭める。
    const { container } = renderReader("# 章だけ\n\n本文が続く。")

    await waitFor(
      () => expect(container.querySelector("h3")).not.toBeNull(),
      PIPELINE_TIMEOUT
    )
    expect(screen.queryByRole("navigation", { name: "目次" })).toBeNull()
    expect(screen.queryByRole("button", { name: /目次/ })).toBeNull()
  })

  it("leaves out the toc while the archive source is selected", async () => {
    const { container } = render(
      <TestProviders queryClient={createTestQueryClient()}>
        <ArticleReaderView
          archiveUrl="/v1/me/article-snapshots/snapshot/replay/index.html"
          archiveUnavailable={false}
          article={makeArticle()}
          articleId="a"
          didAutoFallback={false}
          isArchiveLoading={false}
          isMarkdownLoading={false}
          isRecalculating={false}
          markdown={"# 章\n\n本文\n\n# 別の章"}
          markUnread={() => {}}
          recalculateAi={async () => {}}
          retryArchive={async () => {}}
          setSource={() => {}}
          source="archive"
          toggleHidden={() => {}}
          toggleReadLater={() => {}}
          toggleSaved={() => {}}
        />
      </TestProviders>
    )

    await waitFor(
      () => expect(container.querySelector("iframe")).not.toBeNull(),
      PIPELINE_TIMEOUT
    )
    expect(screen.queryByRole("navigation", { name: "目次" })).toBeNull()
  })
})

describe("ArticleReaderView の1カラム時のfocus", () => {
  it("本文へ現在地を移すが、ページの位置は動かさない", async () => {
    // 1カラムでは一覧と本文がページのスクロールを共有する。focusにスクロール
    // まで任せると、記事が画面へ収まらない時にブラウザが本文を見える所まで送り、
    // 上に居る「一覧へ戻る」が飛ぶ。
    const focus = vi.spyOn(HTMLElement.prototype, "focus")
    renderReader("# 章\n\n本文")

    await waitFor(() => expect(focus).toHaveBeenCalled())
    const target = focus.mock.instances.at(-1) as HTMLElement
    expect(target.tagName).toBe("ARTICLE")
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
  })
})
