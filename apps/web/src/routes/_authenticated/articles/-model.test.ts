import { describe, expect, it } from "vitest"

import {
  aiSummarySnippet,
  applyClientFilters,
  archiveLabel,
  archiveMetaLabel,
  articleBaseUrl,
  articleSnippet,
  dateGroupKey,
  defaultArticlesSearch,
  groupArticlesByDate,
  hasAiEnrichment,
  isArchived,
  MARKDOWN_FALLBACK_MIN_LENGTH,
  shouldFallbackToArchive,
  shouldShowRelevanceScore,
  siblingArticleId,
  toBulkFilter,
  toFacetsQuery,
  toListQuery,
  validateArticlesSearch,
  type Article,
} from "./-model"

const now = new Date("2026-08-11T12:00:00.000Z")

function article(overrides: Partial<Article>): Article {
  return {
    id: "a",
    feedId: "feed-1",
    sourceName: "Zenn",
    title: "React 19の並行機能",
    url: "https://example.com/a",
    discoveredAt: now.toISOString(),
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    usedInEpisode: false,
    ...overrides,
  } as Article
}

describe("validateArticlesSearch", () => {
  it("falls back to defaults for missing or invalid values", () => {
    expect(validateArticlesSearch({})).toEqual(defaultArticlesSearch)
    expect(validateArticlesSearch({ state: "bogus" }).state).toBe("unread")
    expect(validateArticlesSearch({ sort: "bogus" }).sort).toBe("newest")
  })

  it("round-trips valid values, including array and boolean encodings", () => {
    const parsed = validateArticlesSearch({
      state: "saved",
      sort: "oldest",
      q: "otel",
      feedIds: ["feed-1", "feed-2"],
      includeHidden: "true",
      usedInEpisode: "false",
      period: "week",
      archiveStatusFilter: "failed",
      tagIds: ["tag-1"],
    })
    expect(parsed).toEqual({
      state: "saved",
      sort: "oldest",
      q: "otel",
      feedIds: ["feed-1", "feed-2"],
      includeHidden: true,
      usedInEpisode: false,
      period: "week",
      archiveStatusFilter: "failed",
      tagIds: ["tag-1"],
    })
  })

  it("accepts the relevance sort value", () => {
    expect(validateArticlesSearch({ sort: "relevance" }).sort).toBe("relevance")
  })

  it("normalizes a single feedId query value into an array", () => {
    expect(validateArticlesSearch({ feedIds: "feed-1" }).feedIds).toEqual([
      "feed-1",
    ])
  })

  it("round-trips the selected article id, and drops it when blank or missing", () => {
    expect(validateArticlesSearch({ article: "article-42" }).article).toBe(
      "article-42"
    )
    expect(validateArticlesSearch({}).article).toBeUndefined()
    expect(validateArticlesSearch({ article: "" }).article).toBeUndefined()
    expect(validateArticlesSearch({ article: 123 }).article).toBeUndefined()
  })
})

describe("query builders", () => {
  const search = {
    ...defaultArticlesSearch,
    q: "  otel  ",
    feedIds: ["feed-1"],
    includeHidden: true,
  }

  it("omits blank/empty values and trims search text for the list query", () => {
    expect(toListQuery(search)).toEqual({
      q: "otel",
      state: "unread",
      feedIds: ["feed-1"],
      sort: "newest",
      includeHidden: "true",
      usedInEpisode: undefined,
      tagIds: undefined,
    })
    expect(toListQuery(defaultArticlesSearch).q).toBeUndefined()
    expect(toListQuery(defaultArticlesSearch).feedIds).toBeUndefined()
    expect(toListQuery({ ...search, tagIds: ["tag-1"] }).tagIds).toEqual([
      "tag-1",
    ])
  })

  it("keeps the facets query scoped to q/feedIds/includeHidden/tagIds", () => {
    expect(toFacetsQuery(search)).toEqual({
      q: "otel",
      feedIds: ["feed-1"],
      includeHidden: "true",
      tagIds: undefined,
    })
    expect(toFacetsQuery({ ...search, tagIds: ["tag-1"] }).tagIds).toEqual([
      "tag-1",
    ])
  })

  it("keeps the bulk-state filter scoped to server-known axes", () => {
    expect(toBulkFilter(search)).toEqual({
      q: "otel",
      state: "unread",
      feedIds: ["feed-1"],
      includeHidden: true,
    })
  })
})

describe("archive status copy", () => {
  it("keeps status copy exhaustive over the contract", () => {
    expect(archiveLabel("archiving")).toBe("保存中")
    expect(archiveLabel("failed")).toBe("保存失敗")
    expect(isArchived("succeeded")).toBe(true)
    expect(isArchived("pending")).toBe(false)
  })

  it("shows meta text only for pending/failed, not succeeded/archiving", () => {
    expect(archiveMetaLabel("pending")).toBe("保存待ち")
    expect(archiveMetaLabel("failed")).toBe("保存失敗")
    expect(archiveMetaLabel("succeeded")).toBeNull()
    expect(archiveMetaLabel("archiving")).toBeNull()
  })
})

describe("dateGroupKey", () => {
  it("buckets by day distance from now", () => {
    expect(dateGroupKey(now.toISOString(), now)).toBe("today")
    expect(dateGroupKey("2026-08-10T12:00:00.000Z", now)).toBe("yesterday")
    expect(dateGroupKey("2026-08-06T12:00:00.000Z", now)).toBe("thisWeek")
    expect(dateGroupKey("2026-07-01T12:00:00.000Z", now)).toBe("older")
  })
})

describe("groupArticlesByDate", () => {
  it("merges consecutive articles sharing a group and starts a new group otherwise", () => {
    const articles = [
      article({ id: "a", publishedAt: now.toISOString() }),
      article({ id: "b", publishedAt: now.toISOString() }),
      article({ id: "c", publishedAt: "2026-08-01T00:00:00.000Z" }),
    ]
    const groups = groupArticlesByDate(articles, now)
    expect(groups.map((group) => group.key)).toEqual(["today", "older"])
    expect(groups[0]?.articles).toHaveLength(2)
    expect(groups[1]?.articles).toHaveLength(1)
  })
})

describe("applyClientFilters", () => {
  const articles = [
    article({
      id: "a",
      archiveStatus: "succeeded",
      publishedAt: now.toISOString(),
    }),
    article({
      id: "b",
      archiveStatus: "failed",
      publishedAt: "2026-06-01T00:00:00.000Z",
    }),
  ]

  it("filters by archive status", () => {
    const filtered = applyClientFilters(
      articles,
      { period: "all", archiveStatusFilter: "failed" },
      now
    )
    expect(filtered.map((a) => a.id)).toEqual(["b"])
  })

  it("filters by period, measured from now", () => {
    const filtered = applyClientFilters(
      articles,
      { period: "today", archiveStatusFilter: "all" },
      now
    )
    expect(filtered.map((a) => a.id)).toEqual(["a"])
  })
})

describe("articleBaseUrl", () => {
  it("builds an absolute URL, since resolveMarkdownUrl requires an absolute base", () => {
    expect(articleBaseUrl("article-1", "https://app.example.com")).toBe(
      "https://app.example.com/v1/me/articles/article-1/"
    )
  })
})

describe("shouldFallbackToArchive", () => {
  it("falls back when the fetch failed", () => {
    expect(
      shouldFallbackToArchive({ markdown: "a very long body", isError: true })
    ).toBe(true)
  })

  it("falls back when the markdown is missing or blank", () => {
    expect(
      shouldFallbackToArchive({ markdown: undefined, isError: false })
    ).toBe(true)
    expect(shouldFallbackToArchive({ markdown: "   ", isError: false })).toBe(
      true
    )
  })

  it("falls back when the markdown is extremely short", () => {
    const short = "a".repeat(MARKDOWN_FALLBACK_MIN_LENGTH - 1)
    expect(shouldFallbackToArchive({ markdown: short, isError: false })).toBe(
      true
    )
  })

  it("keeps markdown when it clears the length threshold", () => {
    const long = "a".repeat(MARKDOWN_FALLBACK_MIN_LENGTH)
    expect(shouldFallbackToArchive({ markdown: long, isError: false })).toBe(
      false
    )
  })
})

describe("hasAiEnrichment", () => {
  it("shows a non-empty summary even while relevance is unavailable", () => {
    expect(
      hasAiEnrichment({ aiSummary: "## 結論\n要約", relevanceScore: 80 })
    ).toBe(true)
    expect(hasAiEnrichment({ aiSummary: undefined, relevanceScore: 80 })).toBe(
      false
    )
    expect(hasAiEnrichment({ aiSummary: "", relevanceScore: 80 })).toBe(false)
    expect(
      hasAiEnrichment({
        aiSummary: "## 結論\n要約",
        relevanceScore: undefined,
      })
    ).toBe(true)
  })
})

describe("aiSummarySnippet", () => {
  it("skips the heading label and extracts the first plain-text line", () => {
    expect(
      aiSummarySnippet(
        "## 結論\nSuspenseで実装が簡潔になる。\n\n```mermaid\nflowchart LR\na-->b\n```"
      )
    ).toBe("Suspenseで実装が簡潔になる。")
  })

  it("strips emphasis on the first line", () => {
    expect(aiSummarySnippet("- **要点1**\n- 要点2")).toBe("要点1")
    expect(aiSummarySnippet("[リンク](https://example.com)")).toBe("リンク")
  })

  it("caps the snippet at 200 characters", () => {
    const long = "a".repeat(300)
    expect(aiSummarySnippet(long).length).toBe(200)
  })

  it("returns an empty string when the markdown has no text lines", () => {
    expect(aiSummarySnippet("## 結論")).toBe("")
    expect(aiSummarySnippet("```mermaid\nflowchart\n```")).toBe("")
    expect(aiSummarySnippet("")).toBe("")
  })
})

describe("articleSnippet", () => {
  it("prefers the AI Markdown summary when available", () => {
    expect(
      articleSnippet({
        aiSummary: "## 結論\nAIの要点。\n\n図付き。",
        summary: "RSS要約",
      })
    ).toBe("AIの要点。")
  })

  it("falls back to the RSS summary when AI summary is unprocessed", () => {
    expect(articleSnippet({ aiSummary: undefined, summary: "RSS要約" })).toBe(
      "RSS要約"
    )
    expect(articleSnippet({ aiSummary: "", summary: "RSS要約" })).toBe(
      "RSS要約"
    )
  })

  it("returns undefined when neither is available", () => {
    expect(
      articleSnippet({ aiSummary: undefined, summary: undefined })
    ).toBeUndefined()
  })
})

describe("shouldShowRelevanceScore", () => {
  it("shows the score only for the relevance sort", () => {
    expect(shouldShowRelevanceScore("relevance")).toBe(true)
    expect(shouldShowRelevanceScore("newest")).toBe(false)
    expect(shouldShowRelevanceScore("oldest")).toBe(false)
    expect(shouldShowRelevanceScore("source")).toBe(false)
  })
})

describe("siblingArticleId", () => {
  const list = [
    article({ id: "a" }),
    article({ id: "b" }),
    article({ id: "c" }),
  ]

  it("moves forward and backward relative to the current id", () => {
    expect(siblingArticleId(list, "a", 1)).toBe("b")
    expect(siblingArticleId(list, "b", -1)).toBe("a")
  })

  it("returns undefined past either edge", () => {
    expect(siblingArticleId(list, "c", 1)).toBeUndefined()
    expect(siblingArticleId(list, "a", -1)).toBeUndefined()
  })

  it("starts from the first article when nothing is selected yet", () => {
    expect(siblingArticleId(list, undefined, 1)).toBe("a")
  })

  it("returns undefined for an empty list", () => {
    expect(siblingArticleId([], "a", 1)).toBeUndefined()
  })
})
