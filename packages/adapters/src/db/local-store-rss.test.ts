import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("LocalStore RSS reader", () => {
  it("keeps custom feeds scoped while storing archived article state", () => {
    const directory = mkdtempSync(join(tmpdir(), "news-podcast-store-"))
    directories.push(directory)
    const store = new LocalStore(join(directory, "app.sqlite"))
    const owner = "owner-a"
    const otherOwner = "owner-b"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example feed",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.ensureDefaultSubscriptions(otherOwner)

    expect(
      store.listVisibleFeeds(owner).some((item) => item.id === feed.id)
    ).toBe(true)
    expect(
      store.listVisibleFeeds(otherOwner).some((item) => item.id === feed.id)
    ).toBe(false)

    store.upsertFeedItems(feed.id, [
      {
        externalId: "article-1",
        title: "Archived article",
        url: "https://example.com/article",
      },
    ])
    const candidate = store.leaseArchiveCandidate()!
    store.completeArchive({
      articleId: candidate.id,
      snapshotId: "00000000-0000-4000-8000-000000000020",
      sourceUrl: candidate.url,
      title: candidate.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 10,
      assets: [],
    })
    const article = store.listArticles(owner).items[0]!
    expect(article.archiveStatus).toBe("succeeded")

    store.completeArchive({
      articleId: candidate.id,
      snapshotId: "00000000-0000-4000-8000-000000000021",
      sourceUrl: candidate.url,
      title: candidate.title,
      contentHash: "hash",
      rawKey: "raw-refreshed",
      replayKey: "replay-refreshed",
      markdownKey: "markdown-refreshed",
      byteLength: 20,
      assets: [
        {
          hash: "asset-refreshed",
          originalUrl: "https://example.com/style.css",
          key: "asset-key-refreshed",
          contentType: "text/css",
          byteLength: 20,
        },
      ],
    })
    expect(store.getArticleObject(owner, article.id, "replay")).toEqual({
      key: "replay-refreshed",
      snapshotId: "00000000-0000-4000-8000-000000000020",
    })
    expect(store.getArticleAsset(owner, article.id, "asset-refreshed")).toEqual(
      { key: "asset-key-refreshed", contentType: "text/css" }
    )
    expect(
      store.setArticleState(owner, article.id, { read: true })
    ).toMatchObject({
      read: true,
      saved: false,
    })
    expect(store.listArticles(otherOwner).items).toEqual([])
    store.close()
  })
})
