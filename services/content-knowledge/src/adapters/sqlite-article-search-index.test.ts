import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runArticleSearchIndexCycle } from "../application/article-search-index.js"
import { createArticleSearchIndexRepository } from "./persistence/article-search-index/repository.js"
import { openTestDatabase, type TestDatabase } from "./persistence/testing.js"

const databases: TestDatabase[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const insertSnapshot = (
  database: TestDatabase,
  snapshotId: string,
  articleId: string,
  markdownKey: string,
  capturedAt = "2026-08-23T00:00:00.000Z"
) => {
  database.runSql(
    `INSERT INTO article_snapshots
       (archive_request_id, snapshot_id, article_id, snapshot_json, captured_at)
     VALUES (?, ?, ?, json_object(
       'capture', json_object('markdown', json_object('key', ?))
     ), ?)`,
    [`archive-${snapshotId}`, snapshotId, articleId, markdownKey, capturedAt]
  )
}

describe("SQLite article body search index", () => {
  it("persists FTS5 body and short grams before acknowledging queued work", async () => {
    const database = openTestDatabase()
    databases.push(database)
    insertSnapshot(database, "snapshot-a", "article-a", "articles/a.md")
    const repository = createArticleSearchIndexRepository(database.db)

    const [pending] = await Effect.runPromise(repository.listPending(5))
    expect(pending).toMatchObject({
      snapshotId: "snapshot-a",
      articleId: "article-a",
      markdownKey: "articles/a.md",
      attempt: 0,
    })

    await Effect.runPromise(
      repository.index({ pending: pending!, body: "永続本文 xy" })
    )

    expect(
      database.getSql(
        "SELECT body FROM article_search_fts WHERE snapshot_id = 'snapshot-a'"
      )
    ).toEqual({ body: "永続本文 xy" })
    expect(
      database.allSql(
        "SELECT gram FROM article_search_short_grams WHERE snapshot_id = 'snapshot-a' ORDER BY gram"
      )
    ).toEqual(
      expect.arrayContaining([{ gram: "永" }, { gram: "永続" }, { gram: "xy" }])
    )
    expect(await Effect.runPromise(repository.listPending(5))).toEqual([])
  })

  it("keeps failed work durable for a later retry without storing its body", async () => {
    const database = openTestDatabase()
    databases.push(database)
    insertSnapshot(database, "snapshot-b", "article-b", "articles/b.md")
    const repository = createArticleSearchIndexRepository(database.db)

    await Effect.runPromise(
      repository.recordFailure("snapshot-b", "Unavailable")
    )

    expect(await Effect.runPromise(repository.listPending(5))).toEqual([
      expect.objectContaining({
        snapshotId: "snapshot-b",
        attempt: 1,
        lastFailure: "Unavailable",
      }),
    ])
    expect(
      database.getSql(
        "SELECT count(*) AS count FROM article_search_fts WHERE snapshot_id = 'snapshot-b'"
      )
    ).toEqual({ count: 0 })
  })

  it("chunks high-entropy short grams below SQLite's host-parameter limit", async () => {
    const database = openTestDatabase()
    databases.push(database)
    insertSnapshot(
      database,
      "snapshot-large",
      "article-large",
      "articles/large.md"
    )
    const repository = createArticleSearchIndexRepository(database.db)
    const [pending] = await Effect.runPromise(repository.listPending(1))
    const body = Array.from({ length: 17_000 }, (_, index) =>
      String.fromCodePoint(0x1000 + index)
    ).join("")

    await expect(
      Effect.runPromise(repository.index({ pending: pending!, body }))
    ).resolves.toBeUndefined()
    expect(await Effect.runPromise(repository.listPending(1))).toEqual([])
  })

  it("indexes successes and observes per-object failures in one bounded cycle", async () => {
    const database = openTestDatabase()
    databases.push(database)
    insertSnapshot(database, "snapshot-c", "article-c", "articles/c.md")
    insertSnapshot(database, "snapshot-d", "article-d", "articles/d.md")
    const repository = createArticleSearchIndexRepository(database.db)
    const indexed = vi.fn()
    const failed = vi.fn()
    const backlog = vi.fn()

    const outcome = await Effect.runPromise(
      runArticleSearchIndexCycle(
        {
          repository,
          objects: {
            read: (key) =>
              String(key).endsWith("c.md")
                ? Effect.succeed("searchable body")
                : Effect.fail({
                    _tag: "MarkdownObjectFailed" as const,
                    reason: "Unavailable" as const,
                  }),
          },
          observer: { indexed, failed, backlog },
        },
        5
      )
    )

    expect(outcome).toEqual({ processed: 2, indexed: 1, failed: 1 })
    expect(indexed).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledWith({
      snapshotId: "snapshot-d",
      reason: "Unavailable",
      attempt: 1,
    })
    expect(backlog).toHaveBeenCalledWith({ depth: 1 })
    expect(await Effect.runPromise(repository.listPending(5))).toEqual([
      expect.objectContaining({ snapshotId: "snapshot-d", attempt: 1 }),
    ])
  })
})
