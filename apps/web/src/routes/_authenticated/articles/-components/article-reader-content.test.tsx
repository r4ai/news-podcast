import { render, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

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
        archiveHtml={undefined}
        archiveUnavailable={false}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown="![説明](assets/hash123.png)"
        source="markdown"
      />
    )

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(
      new URL("assets/hash123.png", articleBaseUrl(article.id)).toString()
    )
  })

  it("renders the archive HTML inside a sandboxed iframe when the archive source is selected", () => {
    const article = makeArticle({})
    const { container } = render(
      <CompiledContent
        archiveHtml="<html><body>archive</body></html>"
        archiveUnavailable={false}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown={undefined}
        source="archive"
      />
    )

    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("sandbox")).toBe("")
    expect(iframe?.getAttribute("srcdoc")).toBe(
      "<html><body>archive</body></html>"
    )
  })

  it("guides to the original article when neither markdown nor archive is available", () => {
    const article = makeArticle({})
    const { getByText } = render(
      <CompiledContent
        archiveHtml={undefined}
        archiveUnavailable={true}
        article={article}
        isArchiveLoading={false}
        isMarkdownLoading={false}
        markdown={undefined}
        source="archive"
      />
    )

    expect(getByText("元記事を新しいタブで開く")).toBeTruthy()
  })
})
