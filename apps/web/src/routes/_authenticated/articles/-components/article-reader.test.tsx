import { render, screen, waitFor } from "@testing-library/react"
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
        archiveHtml={undefined}
        archiveUnavailable={false}
        article={makeArticle()}
        articleId="a"
        didAutoFallback={false}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        isRecalculating={false}
        markdown={markdown}
        markUnread={noop}
        onBack={noop}
        recalculateAi={asyncNoop}
        setSource={noop}
        source="markdown"
        toggleHidden={noop}
        toggleReadLater={noop}
        toggleSaved={noop}
      />
    </TestProviders>
  )
}

describe("ArticleReaderView table of contents", () => {
  it("shows the toc once the body has enough headings to navigate", async () => {
    const { container } = renderReader("# 章\n\n本文\n\n# 別の章\n\n本文")

    await waitFor(() =>
      expect(
        screen.getAllByRole("navigation", { name: "目次" }).length
      ).toBeGreaterThan(0)
    )
    expect(container.querySelector("details")).not.toBeNull()
  })

  it("leaves out the disclosure and the rail when the toc would be empty", async () => {
    // 見出しが1つだけの記事では目次が何も描かない。器だけ残すと、空の
    // 「目次」と幅だけ取るレールが本文を狭める。
    const { container } = renderReader("# 章だけ\n\n本文が続く。")

    await waitFor(() => expect(container.querySelector("h3")).not.toBeNull())
    expect(screen.queryByRole("navigation", { name: "目次" })).toBeNull()
    expect(container.querySelector("details")).toBeNull()
    expect(container.querySelector(".w-56")).toBeNull()
  })

  it("leaves out the toc while the archive source is selected", async () => {
    const { container } = render(
      <TestProviders queryClient={createTestQueryClient()}>
        <ArticleReaderView
          archiveHtml="<html><body>archive</body></html>"
          archiveUnavailable={false}
          article={makeArticle()}
          articleId="a"
          didAutoFallback={false}
          isArchiveLoading={false}
          isMarkdownLoading={false}
          isRecalculating={false}
          markdown={"# 章\n\n本文\n\n# 別の章"}
          markUnread={() => {}}
          onBack={() => {}}
          recalculateAi={async () => {}}
          setSource={() => {}}
          source="archive"
          toggleHidden={() => {}}
          toggleReadLater={() => {}}
          toggleSaved={() => {}}
        />
      </TestProviders>
    )

    await waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull()
    )
    expect(screen.queryByRole("navigation", { name: "目次" })).toBeNull()
  })
})
