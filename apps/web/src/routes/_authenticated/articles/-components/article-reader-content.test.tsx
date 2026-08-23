import { fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useCompiledMarkdown } from "@/shared/markdown"
import { articleBaseUrl, articleMarkdownOptions, type Article } from "../-model"
import {
  ArticleReaderContent,
  type ArticleReaderContentProps,
} from "./article-reader-content"

/**
 * 本文のコンパイルはリーダー(`ArticleReaderView`)が持ち、結果を本文と目次へ
 * 配る。テストも本番と同じ`articleMarkdownOptions`を通すことで、baseUrlや
 * 見出しレベルの配線が変わったらここで落ちる。
 */
function CompiledContent({
  markdown,
  ...props
}: Omit<ArticleReaderContentProps, "compiled">) {
  const compiled = useCompiledMarkdown(
    markdown ?? "",
    articleMarkdownOptions(props.article)
  )
  return (
    <ArticleReaderContent {...props} compiled={compiled} markdown={markdown} />
  )
}

function makeArticle(overrides: Partial<Article>): Article {
  return {
    id: "article-1",
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
    ...overrides,
  } as Article
}

describe("ArticleReaderContent", () => {
  it("resolves a relative image URL in the markdown body against the article's asset base URL", async () => {
    const article = makeArticle({})
    const { container } = render(
      <CompiledContent
        archiveUrl={undefined}
        archiveUnavailable={false}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown="![説明](assets/hash123.png)"
        retryArchive={() => {}}
        source="markdown"
        useMarkdown={() => {}}
      />
    )

    // Markdownのコンパイル器は遅延importなので、そのファイルで最初の1件は
    // moduleの取得を待つ。既定の1秒では全ファイル同時実行時に足りない。
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull(), {
      timeout: 10_000,
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(
      new URL("assets/hash123.png", articleBaseUrl(article.id)).toString()
    )
  })

  it("renders the replay URL inside a sandboxed iframe when the archive source is selected", () => {
    const article = makeArticle({})
    const { container } = render(
      <CompiledContent
        archiveUrl="/v1/me/article-snapshots/snapshot/replay/index.html"
        archiveUnavailable={false}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown={undefined}
        retryArchive={() => {}}
        source="archive"
        useMarkdown={() => {}}
      />
    )

    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("sandbox")).toBe("")
    expect(iframe?.getAttribute("src")).toBe(
      "/v1/me/article-snapshots/snapshot/replay/index.html"
    )
  })

  it("offers retry and Markdown recovery when the replay iframe fails after resolution", () => {
    const retryArchive = vi.fn()
    const useMarkdown = vi.fn()
    const article = makeArticle({})
    const { container, getByText } = render(
      <CompiledContent
        archiveUrl="/v1/me/article-snapshots/snapshot/replay/index.html"
        archiveUnavailable={false}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown="# 保存済み本文"
        retryArchive={retryArchive}
        source="archive"
        useMarkdown={useMarkdown}
      />
    )

    fireEvent.error(container.querySelector("iframe")!)
    expect(getByText("保存版を読み込めませんでした。")).toBeTruthy()
    fireEvent.click(getByText("再試行"))
    expect(retryArchive).toHaveBeenCalledOnce()
    expect(container.querySelector("iframe")).not.toBeNull()
  })

  it("guides to the original article when neither markdown nor archive is available", () => {
    const article = makeArticle({})
    const { getByText } = render(
      <CompiledContent
        archiveUrl={undefined}
        archiveUnavailable={true}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown={undefined}
        retryArchive={() => {}}
        source="archive"
        useMarkdown={() => {}}
      />
    )

    expect(getByText("再試行")).toBeTruthy()
    expect(getByText("元記事を新しいタブで開く")).toBeTruthy()
  })
})
