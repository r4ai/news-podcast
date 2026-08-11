import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LocalStore } from "@news-podcast/adapters/db/local"
import type { ObjectStore } from "@news-podcast/application"
import { afterEach, describe, expect, it } from "vitest"

import { RssArchiveWorker } from "./process-rss-archive.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-rss-archive-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

// テストが必要とする最小限のObjectStore実装。markdownの取得のみ使う。
class MemoryObjects implements ObjectStore {
  private readonly values = new Map<string, Uint8Array>()

  set(key: string, text: string): void {
    this.values.set(key, new TextEncoder().encode(text))
  }

  put(input: { key: string; body: Uint8Array; contentType: string }) {
    this.values.set(input.key, input.body)
    return Promise.resolve({
      key: input.key,
      byteLength: input.body.byteLength,
      contentType: input.contentType,
    })
  }

  get(key: string) {
    const body = this.values.get(key)
    return Promise.resolve(
      body
        ? { body, contentType: "text/markdown; charset=utf-8", byteLength: body.byteLength }
        : null
    )
  }

  delete(key: string) {
    this.values.delete(key)
    return Promise.resolve()
  }
}

const owner = "owner-a"

// 記事を1件登録し、completeArchiveまで進めた状態（アーカイブ済み・latest_snapshot_id有り）
// にして、feed_item_idを返す。バックフィル対象作りに使う共通処理。
function seedArchivedArticle(
  store: LocalStore,
  externalId: string,
  markdownKey: string
): string {
  const { feed } = store.registerFeed({
    ownerId: owner,
    name: `feed-${externalId}`,
    siteUrl: `https://${externalId}.example.com`,
    feedUrl: `https://${externalId}.example.com/feed.xml`,
  })
  store.upsertFeedItems(feed.id, [
    {
      externalId,
      title: `title-${externalId}`,
      url: `https://${externalId}.example.com/article`,
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
    markdownKey,
    byteLength: 100,
    assets: [],
  })
  return candidate.id
}

describe("RssArchiveWorker.backfillSearchBody", () => {
  it("indexes the archived markdown body into FTS so search can find body-only terms", async () => {
    const store = openStore()
    const objects = new MemoryObjects()
    const markdownKey = "art-1/markdown/article.md"
    objects.set(markdownKey, "蒸気タービンの効率について詳しく解説する記事本文。")
    const articleId = seedArchivedArticle(store, "art-1", markdownKey)
    const worker = new RssArchiveWorker(store, objects)

    const processed = await worker.backfillSearchBody(10)
    expect(processed).toBe(1)

    const hit = store.listArticles(owner, { q: "蒸気タービン" })
    expect(hit.items.map((a) => a.id)).toEqual([articleId])
    store.close()
  })

  it("is idempotent: a second run finds nothing left to backfill", async () => {
    const store = openStore()
    const objects = new MemoryObjects()
    const markdownKey = "art-2/markdown/article.md"
    objects.set(markdownKey, "some body text")
    seedArchivedArticle(store, "art-2", markdownKey)
    const worker = new RssArchiveWorker(store, objects)

    expect(await worker.backfillSearchBody(10)).toBe(1)
    expect(await worker.backfillSearchBody(10)).toBe(0)
    store.close()
  })

  it("processes at most N articles per call, in discovery order", async () => {
    const store = openStore()
    const objects = new MemoryObjects()
    for (const id of ["a", "b", "c"]) {
      const key = `${id}/markdown/article.md`
      objects.set(key, `body for ${id}`)
      seedArchivedArticle(store, id, key)
    }
    const worker = new RssArchiveWorker(store, objects)

    expect(await worker.backfillSearchBody(2)).toBe(2)
    expect(await worker.backfillSearchBody(2)).toBe(1)
    expect(await worker.backfillSearchBody(2)).toBe(0)
    store.close()
  })

  it("keeps an article pending when its markdown object is temporarily missing", async () => {
    const store = openStore()
    const objects = new MemoryObjects()
    // 敢えてset()を呼ばず、オブジェクトストアに実体が無い状態を作る。
    seedArchivedArticle(store, "missing-object", "missing/markdown/article.md")
    const worker = new RssArchiveWorker(store, objects)

    await expect(worker.backfillSearchBody(10)).resolves.toBe(0)

    objects.set("missing/markdown/article.md", "後から利用可能になった記事本文。")
    expect(await worker.backfillSearchBody(10)).toBe(1)
    expect(await worker.backfillSearchBody(10)).toBe(0)
    store.close()
  })
})
