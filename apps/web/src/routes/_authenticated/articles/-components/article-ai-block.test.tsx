import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Article } from "../-model"
import { ArticleAiBlock } from "./article-ai-block"

function article(overrides: Partial<Article>): Article {
  return {
    id: "article-1",
    feedId: "feed-1",
    sourceName: "Example",
    title: "記事",
    url: "https://example.com/article",
    discoveredAt: "2026-08-12T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    ...overrides,
  } as Article
}

describe("ArticleAiBlock", () => {
  it("renders a generated summary when relevance scoring is unavailable", async () => {
    const view = render(
      <ArticleAiBlock
        article={article({ aiSummary: "## 結論\n生成済みの要約" })}
        isRecalculating={false}
        onRecalculate={vi.fn()}
      />
    )

    await waitFor(() => expect(view.getByText("生成済みの要約")).toBeTruthy())
    expect(view.getByText("適合度未計算")).toBeTruthy()
    expect(view.queryByLabelText("適合度")).toBeNull()
  })

  it("renders relevance when both enrichment results are available", async () => {
    const view = render(
      <ArticleAiBlock
        article={article({
          aiSummary: "## 結論\n生成済みの要約",
          relevanceScore: 82,
          relevanceReason: "興味に合致するから",
        })}
        isRecalculating={false}
        onRecalculate={vi.fn()}
      />
    )

    await waitFor(() => expect(view.getByText("生成済みの要約")).toBeTruthy())
    expect(view.getByLabelText("適合度 82")).toBeTruthy()
    expect(view.getByText("興味に合致するから")).toBeTruthy()
  })
})
