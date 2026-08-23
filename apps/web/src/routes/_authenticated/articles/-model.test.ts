import { describe, expect, it } from "vitest"

import {
  applyFacetsDelta,
  archiveLabel,
  archiveMetaLabel,
  articleBaseUrl,
  replaceArticleInPages,
  dateGroupKey,
  defaultArticlesSearch,
  groupArticlesByDate,
  hasAiEnrichment,
  isArchived,
  MARKDOWN_FALLBACK_MIN_LENGTH,
  shouldFallbackToArchive,
  siblingArticleId,
  toBulkFilter,
  toFacetsQuery,
  toListQuery,
  validateArticlesSearch,
  type Article,
  type ArticleFlags,
} from "./-model"
import { aiSummarySnippet, articleSnippet } from "./-snippet"

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
    })
    expect(parsed).toEqual({
      state: "saved",
      sort: "oldest",
      q: "otel",
      feedIds: ["feed-1", "feed-2"],
      includeHidden: true,
    })
  })

  it("falls back when an unimplemented sort value is supplied", () => {
    expect(validateArticlesSearch({ sort: "relevance" }).sort).toBe("newest")
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

  it("keeps an exact snapshot only when an article is selected", () => {
    expect(
      validateArticlesSearch({ article: "article-42", snapshot: "snapshot-1" })
    ).toMatchObject({ article: "article-42", snapshot: "snapshot-1" })
    expect(
      validateArticlesSearch({ snapshot: "snapshot-1" }).snapshot
    ).toBeUndefined()
    expect(
      validateArticlesSearch({ article: "article-42", snapshot: "" }).snapshot
    ).toBeUndefined()
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
    })
    expect(toListQuery(defaultArticlesSearch).q).toBeUndefined()
    expect(toListQuery(defaultArticlesSearch).feedIds).toBeUndefined()
  })

  it("keeps the facets query scoped to q/feedIds/includeHidden", () => {
    expect(toFacetsQuery(search)).toEqual({
      q: "otel",
      feedIds: ["feed-1"],
      includeHidden: "true",
    })
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

describe("articleBaseUrl", () => {
  it("builds an absolute URL, since resolveMarkdownUrl requires an absolute base", () => {
    expect(articleBaseUrl("article-1", "https://app.example.com")).toBe(
      "https://app.example.com/v1/me/articles/article-1/"
    )
  })

  it("binds relative assets to the selected immutable snapshot", () => {
    expect(
      articleBaseUrl("article-1", "https://app.example.com", "snapshot-v1")
    ).toBe("https://app.example.com/v1/me/article-snapshots/snapshot-v1/")
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

describe("applyFacetsDelta", () => {
  const facets = {
    states: { all: 10, unread: 4, saved: 3, later: 2 },
    feeds: [
      { feedId: "feed-1", name: "Zenn", count: 6 },
      { feedId: "feed-2", name: "HN", count: 4 },
    ],
    aiPending: 5,
  }
  const flags: ArticleFlags = {
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  }
  type Delta = Partial<Record<"all" | "unread" | "saved" | "later", number>>
  const change = (
    before: Partial<ArticleFlags>,
    after: Partial<ArticleFlags>,
    includeHidden = false
  ) =>
    applyFacetsDelta(facets, {
      feedId: "feed-1",
      includeHidden,
      before: { ...flags, ...before },
      after: { ...flags, ...after },
    })!

  it.each<[string, Partial<ArticleFlags>, Partial<ArticleFlags>, Delta]>([
    ["reading an unread article", {}, { read: true }, { unread: -1 }],
    ["restoring it to unread", { read: true }, {}, { unread: 1 }],
    ["saving", {}, { saved: true }, { saved: 1 }],
    ["unsaving", { saved: true }, {}, { saved: -1 }],
    ["deferring", {}, { readLater: true }, { later: 1 }],
  ])(
    "shifts only the affected count when %s",
    (_name, before, after, delta) => {
      expect(change(before, after).states).toEqual({
        all: facets.states.all + (delta.all ?? 0),
        unread: facets.states.unread + (delta.unread ?? 0),
        saved: facets.states.saved + (delta.saved ?? 0),
        later: facets.states.later + (delta.later ?? 0),
      })
    }
  )

  it("drops a hidden article out of every count, including its feed", () => {
    const next = change({}, { hidden: true })
    expect(next.states).toEqual({ all: 9, unread: 3, saved: 3, later: 2 })
    expect(next.feeds).toEqual([
      { feedId: "feed-1", name: "Zenn", count: 5 },
      { feedId: "feed-2", name: "HN", count: 4 },
    ])
  })

  it("brings an unhidden article back into every count it belongs to", () => {
    const next = change({ hidden: true, saved: true }, { saved: true })
    expect(next.states).toEqual({ all: 11, unread: 5, saved: 4, later: 2 })
    expect(next.feeds[0]).toEqual({ feedId: "feed-1", name: "Zenn", count: 7 })
  })

  it("ignores hidden transitions while hidden articles are included", () => {
    expect(change({}, { hidden: true }, true)).toEqual(facets)
  })

  it("leaves counts untouched when nothing that is counted changed", () => {
    expect(change({ hidden: true }, { hidden: true, saved: true })).toEqual(
      facets
    )
  })

  it("never lets a count fall below zero", () => {
    const empty = {
      states: { all: 0, unread: 0, saved: 0, later: 0 },
      feeds: [{ feedId: "feed-1", name: "Zenn", count: 0 }],
      aiPending: 0,
    }
    const next = applyFacetsDelta(empty, {
      feedId: "feed-1",
      includeHidden: false,
      before: { ...flags },
      after: { ...flags, hidden: true },
    })!
    expect(next.states).toEqual({ all: 0, unread: 0, saved: 0, later: 0 })
    expect(next.feeds[0]?.count).toBe(0)
  })

  it("keeps the AI backlog and unknown feeds out of the state delta", () => {
    const next = applyFacetsDelta(facets, {
      feedId: "feed-unlisted",
      includeHidden: false,
      before: { ...flags },
      after: { ...flags, read: true },
    })!
    expect(next.aiPending).toBe(5)
    expect(next.feeds).toEqual(facets.feeds)
    expect(next.states.unread).toBe(3)
  })

  it("returns the same reference when there are no facets yet", () => {
    expect(
      applyFacetsDelta(undefined, {
        feedId: "feed-1",
        includeHidden: false,
        before: { ...flags },
        after: { ...flags, read: true },
      })
    ).toBeUndefined()
  })
})

describe("replaceArticleInPages", () => {
  const pages = [
    {
      items: [article({ id: "a" }), article({ id: "b" })],
      page: { hasMore: true, nextCursor: "c1" },
    },
    { items: [article({ id: "c" })], page: { hasMore: false } },
  ]

  it("replaces the matching article in the page that holds it", () => {
    const next = replaceArticleInPages(pages, article({ id: "b", saved: true }))
    expect(next[0]?.items[1]?.saved).toBe(true)
    expect(next[0]?.items[0]).toBe(pages[0]?.items[0])
    // 触れていないページは同一参照のまま渡し、再レンダリングを広げない。
    expect(next[1]).toBe(pages[1])
  })

  it("drops the article from every page when it must leave the filter", () => {
    const next = replaceArticleInPages(pages, article({ id: "b" }), {
      drop: true,
    })
    expect(next[0]?.items.map((item) => item.id)).toEqual(["a"])
    expect(next[1]).toBe(pages[1])
  })

  it("keeps the page cursors intact so the next fetch still continues", () => {
    const next = replaceArticleInPages(pages, article({ id: "a", read: true }))
    expect(next[0]?.page).toEqual({ hasMore: true, nextCursor: "c1" })
  })

  it("returns the same pages when the article is not cached", () => {
    expect(replaceArticleInPages(pages, article({ id: "zzz" }))).toBe(pages)
  })
})
