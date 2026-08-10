import { describe, expect, it } from "vitest"

import { archiveLabel, filterArticles, isArchived } from "./-model"
import type { Article } from "./-model"

const articles = [
  { id: "a", title: "React 19の並行機能", sourceName: "Zenn" },
  { id: "b", title: "OTelの入門", sourceName: "Hacker News" },
] as unknown as Article[]

describe("articles display model", () => {
  it("matches on both title and source name, case-insensitively", () => {
    expect(filterArticles(articles, "react")).toHaveLength(1)
    expect(filterArticles(articles, "hacker")).toHaveLength(1)
    expect(filterArticles(articles, "存在しない")).toHaveLength(0)
  })

  it("returns every article when the search box is blank", () => {
    expect(filterArticles(articles, "   ")).toBe(articles)
  })

  it("keeps archive status copy exhaustive over the contract", () => {
    expect(archiveLabel("archiving")).toBe("保存中")
    expect(archiveLabel("failed")).toBe("保存失敗")
    expect(isArchived("succeeded")).toBe(true)
    expect(isArchived("pending")).toBe(false)
  })
})
