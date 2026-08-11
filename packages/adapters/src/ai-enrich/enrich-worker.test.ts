import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type {
  ArticleRelevanceScorer,
  ArticleSummarizer,
  ObjectStore,
  RelevanceBatchResult,
} from "@news-podcast/application"

import { LocalStore } from "../db/local-store.js"
import { AiEnrichWorker, type AiEnrichEvent } from "./enrich-worker.js"
import { ProviderRateLimitError, RELEVANCE_BATCH_SIZE } from "./shared.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-enrich-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

// 記事を1件登録し、アーカイブ済み（latest_snapshot_id有り）状態にして
// feed_item_idを返す。
function seedArchivedArticle(
  store: LocalStore,
  ownerId: string,
  externalId: string
): string {
  const { feed } = store.registerFeed({
    ownerId,
    name: `feed-${externalId}`,
    siteUrl: `https://${externalId}.example.com`,
    feedUrl: `https://${externalId}.example.com/feed.xml`,
  })
  store.upsertFeedItems(feed.id, [
    {
      externalId,
      title: `title-${externalId}`,
      url: `https://${externalId}.example.com/article`,
      publishedAt: new Date().toISOString(),
    },
  ])
  const candidate = store.leaseArchiveCandidate()!
  store.completeArchive({
    articleId: candidate.id,
    snapshotId: `${externalId}-snapshot`,
    sourceUrl: candidate.url,
    title: candidate.title,
    contentHash: `${externalId}-hash`,
    rawKey: `${externalId}/raw.html`,
    replayKey: `${externalId}/replay.html`,
    markdownKey: `${externalId}/markdown.md`,
    byteLength: 100,
    assets: [],
  })
  return candidate.id
}

function fakeObjects(): ObjectStore {
  return {
    get: () =>
      Promise.resolve({
        body: new TextEncoder().encode("本文"),
        contentType: "text/markdown",
        byteLength: 2,
      }),
    put: () => {
      throw new Error("not used")
    },
    delete: () => Promise.resolve(),
  }
}

function fakeSummarizer(tokensIn = 100, tokensOut = 30): ArticleSummarizer {
  return {
    summarize: () =>
      Promise.resolve({
        bullets: ["要点1", "要点2", "要点3"],
        tokensIn,
        tokensOut,
      }),
  }
}

// 呼ばれたcandidatesのバッチサイズを記録しつつ、全件へ固定スコアを返すfake。
// scoreForはtitle（seedArchivedArticleが`title-${externalId}`で付与）で判定する。
function fakeScorer(
  calls: number[][],
  scoreFor: (title: string) => number = () => 50,
  tagsFor: (title: string) => {
    readonly tags: readonly string[]
    readonly suggestedTags: readonly string[]
  } = () => ({ tags: [], suggestedTags: [] })
): ArticleRelevanceScorer {
  return {
    score: (input): Promise<RelevanceBatchResult> => {
      calls.push(input.candidates.map(() => 1))
      return Promise.resolve({
        scores: input.candidates.map((candidate) => ({
          feedItemId: candidate.feedItemId,
          score: scoreFor(candidate.title),
          reason: "テスト理由",
          ...tagsFor(candidate.title),
        })),
        tokensIn: 100,
        tokensOut: 40,
      })
    },
  }
}

describe("AiEnrichWorker.runOnce", () => {
  it("skips articles whose relevance already matches the current profile hash and prompt version", async () => {
    const store = openStore()
    const owner = "owner-a"
    const feedItemId = seedArchivedArticle(store, owner, "skip-test")

    const scorerCalls: number[][] = []
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer(scorerCalls),
      "gpt-5.6-luna"
    )
    await worker.runOnce()
    expect(scorerCalls.length).toBe(1)
    expect(store.getArticle(owner, feedItemId)?.relevanceScore).toBe(50)

    // 2回目: profile_hash/prompt_versionが不変なので候補から外れ、再度スコアリングされない。
    await worker.runOnce()
    expect(scorerCalls.length).toBe(1)
  })

  it("reprocesses once the interest profile changes (profile_hash mismatch)", async () => {
    const store = openStore()
    const owner = "owner-b"
    seedArchivedArticle(store, owner, "profile-change")

    const scorerCalls: number[][] = []
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer(scorerCalls),
      "gpt-5.6-luna"
    )
    await worker.runOnce()
    expect(scorerCalls.length).toBe(1)

    store.setInterestProfile(owner, { include: "AI 半導体", exclude: "" })
    await worker.runOnce()
    expect(scorerCalls.length).toBe(2)
  })

  it("enforces the daily processing limit across owners", async () => {
    const store = openStore()
    for (let index = 0; index < 5; index += 1) {
      seedArchivedArticle(store, "owner-limit", `limit-${index}`)
    }

    const scorerCalls: number[][] = []
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer(scorerCalls),
      "gpt-5.6-luna",
      3
    )
    const now = new Date("2026-08-11T00:00:00.000Z")
    await worker.runOnce(now)

    const scoredCount = scorerCalls.flat().length
    expect(scoredCount).toBeLessThanOrEqual(3)
    expect(store.getEnrichProcessedToday("2026-08-11")).toBe(scoredCount)
  })

  it("batches relevance scoring calls at RELEVANCE_BATCH_SIZE (5-10) instead of one call per article", async () => {
    const store = openStore()
    const owner = "owner-batch"
    const total = RELEVANCE_BATCH_SIZE * 2
    for (let index = 0; index < total; index += 1) {
      seedArchivedArticle(store, owner, `batch-${index}`)
    }

    const scorerCalls: number[][] = []
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer(scorerCalls),
      "gpt-5.6-luna",
      1_000
    )
    // 1tickあたりの候補上限がRELEVANCE_BATCH_SIZE分なので、全件処理するには
    // 複数tick分runOnceを呼ぶ（各tickは高々1バッチ、複数tickに渡って
    // 「1記事1コール」にはならないことを確認する）。
    for (let tick = 0; tick < 5; tick += 1) {
      await worker.runOnce()
    }

    expect(
      store.getEnrichProcessedToday(new Date().toISOString().slice(0, 10))
    ).toBe(total)
    expect(scorerCalls.length).toBeGreaterThan(1)
    for (const call of scorerCalls) {
      expect(call.length).toBeGreaterThan(1)
      expect(call.length).toBeLessThanOrEqual(RELEVANCE_BATCH_SIZE)
    }
  })

  it("isolates relevance scores per owner even for the same underlying article batch call", async () => {
    const store = openStore()
    seedArchivedArticle(store, "owner-x", "shared-1")
    seedArchivedArticle(store, "owner-y", "shared-2")

    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer([], (title) => (title.includes("shared-1") ? 90 : 10)),
      "gpt-5.6-luna"
    )
    await worker.runOnce()

    const articlesX = store.listArticles("owner-x")
    const articlesY = store.listArticles("owner-y")
    expect(articlesX.items).toHaveLength(1)
    expect(articlesY.items).toHaveLength(1)
    expect(articlesX.items[0]?.relevanceScore).toBe(90)
    expect(articlesY.items[0]?.relevanceScore).toBe(10)
  })

  it("records token usage on the relevance rows, summing to the reported batch total", async () => {
    const store = openStore()
    const owner = "owner-tokens"
    seedArchivedArticle(store, owner, "tok-1")
    seedArchivedArticle(store, owner, "tok-2")

    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer([]),
      "gpt-5.6-luna"
    )
    await worker.runOnce()

    const rows = store.database
      .prepare(
        "SELECT tokens_in, tokens_out FROM article_relevance WHERE owner_id = ?"
      )
      .all(owner) as { tokens_in: number; tokens_out: number }[]
    expect(rows).toHaveLength(2)
    const sumIn = rows.reduce((total, row) => total + row.tokens_in, 0)
    const sumOut = rows.reduce((total, row) => total + row.tokens_out, 0)
    expect(sumIn).toBe(100)
    expect(sumOut).toBe(40)
  })

  it("emits a rate_limited-flagged failure event and marks the batch failed on 429", async () => {
    const store = openStore()
    const owner = "owner-429"
    seedArchivedArticle(store, owner, "rl-1")

    const events: AiEnrichEvent[] = []
    const failingScorer: ArticleRelevanceScorer = {
      score: () => Promise.reject(new ProviderRateLimitError()),
    }
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      failingScorer,
      "gpt-5.6-luna",
      undefined,
      (event) => events.push(event)
    )
    await worker.runOnce()

    expect(
      events.some(
        (event) => event.type === "relevance_failed" && event.rateLimited
      )
    ).toBe(true)
  })
})

describe("AiEnrichWorker タグ付与の相乗り", () => {
  it("assigns AI tags that are within the vocabulary and files vocabulary-external names as suggestions", async () => {
    const store = openStore()
    const owner = "owner-tags"
    const feedItemId = seedArchivedArticle(store, owner, "tag-test")
    const aiTag = store.createTag(owner, "AI")

    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer([], undefined, () => ({
        tags: ["AI"],
        suggestedTags: ["新語彙"],
      })),
      "gpt-5.6-luna"
    )
    await worker.runOnce()

    const article = store.getArticle(owner, feedItemId)
    expect(article?.tags).toEqual(["AI"])
    const suggestions = store.listTagSuggestions(owner)
    expect(suggestions).toEqual([
      { name: "新語彙", occurrences: 1, lastSeenAt: expect.any(String) },
    ])
    // 語彙にあるタグ自体はarticle_tagsへ、語彙に無い名前はtags側へは入らない。
    expect(store.listTags(owner).map((tag) => tag.id)).toEqual([aiTag.id])
  })

  it("skips tagging entirely when the owner has no tag vocabulary", async () => {
    const store = openStore()
    const owner = "owner-no-vocab"
    const feedItemId = seedArchivedArticle(store, owner, "no-vocab")

    let receivedVocabulary: readonly string[] | undefined
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      {
        score: (input) => {
          receivedVocabulary = input.tagVocabulary
          return Promise.resolve({
            scores: input.candidates.map((candidate) => ({
              feedItemId: candidate.feedItemId,
              score: 50,
              reason: "テスト理由",
              tags: [],
              suggestedTags: [],
            })),
            tokensIn: 10,
            tokensOut: 5,
          })
        },
      },
      "gpt-5.6-luna"
    )
    await worker.runOnce()

    expect(receivedVocabulary).toEqual([])
    expect(store.getArticle(owner, feedItemId)?.tags).toEqual([])
  })
})

describe("AiEnrichWorker.enrichOne", () => {
  it("returns false for an article that has not finished archiving", async () => {
    const store = openStore()
    const owner = "owner-c"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "feed",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "pending", title: "t", url: "https://example.com/p" },
    ])
    const [pending] = store.listArticles(owner).items
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer([]),
      "gpt-5.6-luna"
    )
    await expect(worker.enrichOne(owner, pending!.id)).resolves.toBe(false)
  })

  it("recomputes even if a matching relevance row already exists", async () => {
    const store = openStore()
    const owner = "owner-d"
    const feedItemId = seedArchivedArticle(store, owner, "ondemand")
    const scorerCalls: number[][] = []
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      fakeScorer(scorerCalls),
      "gpt-5.6-luna"
    )
    await worker.runOnce()
    expect(scorerCalls.length).toBe(1)

    await expect(worker.enrichOne(owner, feedItemId)).resolves.toBe(true)
    expect(scorerCalls.length).toBe(2)
  })

  it("propagates an on-demand summary provider failure", async () => {
    const store = openStore()
    const owner = "owner-summary-failure"
    const feedItemId = seedArchivedArticle(store, owner, "summary-failure")
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      { summarize: () => Promise.reject(new Error("summary unavailable")) },
      fakeScorer([]),
      "gpt-5.6-luna"
    )

    await expect(worker.enrichOne(owner, feedItemId)).rejects.toThrow(
      "summary unavailable"
    )
  })

  it("propagates an on-demand relevance provider failure", async () => {
    const store = openStore()
    const owner = "owner-relevance-failure"
    const feedItemId = seedArchivedArticle(store, owner, "relevance-failure")
    const worker = new AiEnrichWorker(
      store,
      fakeObjects(),
      fakeSummarizer(),
      { score: () => Promise.reject(new Error("scorer unavailable")) },
      "gpt-5.6-luna"
    )

    await expect(worker.enrichOne(owner, feedItemId)).rejects.toThrow(
      "scorer unavailable"
    )
  })
})
