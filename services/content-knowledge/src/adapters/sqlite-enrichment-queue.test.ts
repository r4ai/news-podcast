import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { CapturedAtSchema } from "../domain/article.js"
import type { EnrichmentProviderOutput } from "../domain/enrichment.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { openTestDatabase, type TestDatabase } from "./persistence/testing.js"
import { createEnrichmentQueue } from "./persistence/enrichment-queue/repository.js"
import { createSubscriptionRepository } from "./persistence/subscription/repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const databases: TestDatabase[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const now = decode(CapturedAtSchema, "2026-08-13T01:00:00.000Z")
const later = decode(CapturedAtSchema, "2026-08-13T01:20:00.000Z")
const expires = decode(CapturedAtSchema, "2026-08-13T01:10:00.000Z")
const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never
const feedA = "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
const feedB = "c7f32a8b-5358-4f4b-837b-b8b21965e65a"
const subscriptionA = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
const subscriptionB = "33bd5f2a-7809-4275-90d9-89dc01da9c60"

const setup = async () => {
  const database = openTestDatabase()
  databases.push(database)
  database.execSql(`
    INSERT INTO feed_catalog VALUES ('${feedA}', 'https://a.example/feed', '${now}');
    INSERT INTO feed_catalog VALUES ('${feedB}', 'https://b.example/feed', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('${subscriptionA}', 'owner-a', '${feedA}', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('${subscriptionB}', 'owner-b', '${feedB}', '${now}');
    INSERT INTO feed_items(article_id, feed_id, external_id, source_url, title, published_at, discovered_at) VALUES ('${articleId}', '${feedA}', 'a', 'https://a.example/a', 'A', NULL, '${now}');
    INSERT INTO article_owner_access VALUES ('owner-a', '${articleId}', '${now}');
    INSERT INTO article_snapshots(archive_request_id, snapshot_id, article_id, snapshot_json, captured_at) VALUES (
      'request-a', 'snapshot-a', '${articleId}',
      '{"articleId":"${articleId}","capture":{"markdown":{"key":"articles/a/article.md"}}}',
      '${now}'
    );
  `)
  return {
    database,
    queue: await Effect.runPromise(createEnrichmentQueue(database.db)),
  }
}

const output: EnrichmentProviderOutput = {
  summary: "summary",
  score: 80,
  reason: "relevant",
  tags: [],
  suggestedTags: [],
  tokensIn: 10,
  tokensOut: 5,
} as never

describe("SQLite enrichment queue", () => {
  it("moves New through Queued -> Processing -> Succeeded and counts the budget atomically", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const before = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(before.pending).toMatchObject({
      count: 1,
      items: [{ reason: "New", attempt: 0 }],
    })

    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 8, now, expires, "lease-token-0001")
    )
    expect(claim).toMatchObject({ articleId, leaseToken: "lease-token-0001" })
    expect(
      (await Effect.runPromise(queue.status(ownerA, 200, "2026-08-13")))
        .processing
    ).toHaveLength(1)

    expect(
      await Effect.runPromise(
        queue.reserveAttempt(ownerA, claim!, now, "2026-08-13", 200)
      )
    ).toBe(true)

    await Effect.runPromise(queue.completeSuccess(ownerA, claim!, output, now))
    const after = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(after.processing).toHaveLength(0)
    expect(after.recent[0]).toMatchObject({ status: "Succeeded" })
    expect(after.daily).toEqual({ used: 1, limit: 200 })
  })

  it("atomically caps paid attempts and releases an unreserved lease without consuming it", async () => {
    const { database, queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )

    expect(
      await Effect.runPromise(
        queue.reserveAttempt(ownerA, claim!, now, "2026-08-13", 1)
      )
    ).toBe(true)
    expect(
      await Effect.runPromise(
        queue.reserveAttempt(ownerA, claim!, now, "2026-08-13", 1)
      )
    ).toBe(false)
    expect(
      database.getSql(
        "SELECT processed_count AS used FROM content_enrichment_daily_progress WHERE owner_id = ? AND local_date = ?",
        [ownerA, "2026-08-13"]
      )
    ).toEqual({ used: 1 })
  })

  it("does not reserve a paid attempt for a stale lease", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )

    await expect(
      Effect.runPromise(
        queue.reserveAttempt(
          ownerA,
          { ...claim!, leaseToken: "stale-token-0000" },
          now,
          "2026-08-13",
          1
        )
      )
    ).rejects.toMatchObject({
      _tag: "EnrichmentQueueFailed",
      operation: "Budget",
    })
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-13"))
    ).toBe(0)
  })

  it("does not charge a provider attempt after its lease expires", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )

    await expect(
      Effect.runPromise(
        queue.reserveAttempt(ownerA, claim!, later, "2026-08-13", 1)
      )
    ).rejects.toMatchObject({
      _tag: "EnrichmentQueueFailed",
      operation: "Budget",
    })
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-13"))
    ).toBe(0)
  })

  it("rejects stale lease completion and reclaims an expired lease", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )
    await expect(
      Effect.runPromise(
        queue.completeSuccess(
          ownerA,
          { ...claim!, leaseToken: "stale-token-000" },
          output,
          now
        )
      )
    ).rejects.toMatchObject({
      _tag: "EnrichmentQueueFailed",
      operation: "Complete",
    })

    await Effect.runPromise(queue.reconcile(later))
    const reclaimed = await Effect.runPromise(
      queue.claim(ownerA, 1, later, expires, "lease-token-0002")
    )
    expect(reclaimed).toHaveLength(1)
  })

  it("retries transient failure to the cap and explicit reprocess resets the terminal state", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [claim] = await Effect.runPromise(
        queue.claim(ownerA, 1, now, expires, `lease-token-000${attempt}`)
      )
      await Effect.runPromise(
        queue.completeFailure(ownerA, claim!, `temporary-${attempt}`, true, now)
      )
    }
    const failed = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(failed.pending.count).toBe(0)
    expect(failed.failed).toMatchObject({ count: 1, items: [{ attempt: 4 }] })

    expect(await Effect.runPromise(queue.enqueueReprocess(ownerA, later))).toBe(
      1
    )
    const reset = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(reset.pending).toMatchObject({
      count: 1,
      items: [{ reason: "Reprocess", attempt: 0, status: "Queued" }],
    })
  })

  it("terminalizes permanent failures immediately and enforces owner isolation", async () => {
    const { queue } = await setup()
    expect(
      await Effect.runPromise(queue.enqueueOne(ownerB, articleId, now))
    ).toEqual({
      _tag: "NotFound",
    })
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )
    await Effect.runPromise(
      queue.completeFailure(ownerA, claim!, "invalid request", false, now)
    )
    expect(
      await Effect.runPromise(queue.status(ownerA, 200, "2026-08-13"))
    ).toMatchObject({ failed: { count: 1, items: [{ attempt: 4 }] } })
    expect(
      await Effect.runPromise(queue.status(ownerB, 200, "2026-08-13"))
    ).toMatchObject({ failed: { count: 0 }, pending: { count: 0 } })
  })
  it("lists every subscribing owner once, in a stable order", async () => {
    const { queue } = await setup()

    expect(await Effect.runPromise(queue.listOwners())).toEqual([
      ownerA,
      ownerB,
    ])
  })

  it("defers shared-feed AI work while paused and backfills it after resume", async () => {
    const { database, queue } = await setup()
    const subscriptions = await Effect.runPromise(
      createSubscriptionRepository(database.db)
    )
    const sharedArticleId = "04b51d15-f488-4076-b99a-3c98f1feab05"
    await Effect.runPromise(
      subscriptions.setEnabled(ownerA, subscriptionA as never, false)
    )
    database.execSql(`
      INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at)
      VALUES ('89278c92-78bf-4913-aa6f-27e7a2847154', 'owner-b', '${feedA}', '${now}');
      INSERT INTO feed_items(article_id, feed_id, external_id, source_url, title, published_at, discovered_at)
      VALUES ('${sharedArticleId}', '${feedA}', 'shared', 'https://a.example/shared', 'Shared', NULL, '${now}');
      INSERT INTO article_owner_access VALUES ('owner-b', '${sharedArticleId}', '${now}');
      INSERT INTO article_snapshots(archive_request_id, snapshot_id, article_id, snapshot_json, captured_at) VALUES (
        'request-shared', 'snapshot-shared', '${sharedArticleId}',
        '{"articleId":"${sharedArticleId}","capture":{"markdown":{"key":"articles/shared/article.md"}}}',
        '${now}'
      );
    `)

    await Effect.runPromise(queue.reconcile(now))

    expect(await Effect.runPromise(queue.listOwners())).toEqual([ownerB])
    expect(
      database.allSql(
        `SELECT owner_id, article_id FROM content_enrichment_queue
         WHERE article_id = '${sharedArticleId}' ORDER BY owner_id`
      )
    ).toEqual([{ owner_id: ownerB, article_id: sharedArticleId }])

    await Effect.runPromise(
      subscriptions.setEnabled(ownerA, subscriptionA as never, true)
    )
    await Effect.runPromise(queue.reconcile(later))

    expect(
      database.allSql(
        `SELECT owner_id, article_id FROM content_enrichment_queue
         WHERE article_id = '${sharedArticleId}' ORDER BY owner_id`
      )
    ).toEqual([
      { owner_id: ownerA, article_id: sharedArticleId },
      { owner_id: ownerB, article_id: sharedArticleId },
    ])
  })

  it("does not claim queued work for a paused feed when another feed stays enabled", async () => {
    const { database, queue } = await setup()
    const subscriptions = await Effect.runPromise(
      createSubscriptionRepository(database.db)
    )
    database.execSql(`
      INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at)
      VALUES ('5d31cf0f-d2b1-45e1-a0cc-bc6668c8348a', 'owner-a', '${feedB}', '${now}');
    `)
    await Effect.runPromise(queue.reconcile(now))
    await Effect.runPromise(
      subscriptions.setEnabled(ownerA, subscriptionA as never, false)
    )

    expect(await Effect.runPromise(queue.listOwners())).toEqual([
      ownerA,
      ownerB,
    ])
    expect(
      await Effect.runPromise(
        queue.claim(ownerA, 1, now, expires, "lease-token-paused")
      )
    ).toEqual([])

    await Effect.runPromise(
      subscriptions.setEnabled(ownerA, subscriptionA as never, true)
    )
    expect(
      await Effect.runPromise(
        queue.claim(ownerA, 1, later, expires, "lease-token-resumed")
      )
    ).toMatchObject([{ articleId }])
  })

  it("claims nothing when the requested batch is empty", async () => {
    const { database, queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))

    expect(
      await Effect.runPromise(
        queue.claim(ownerA, 0, now, expires, "lease-token-0000")
      )
    ).toEqual([])
    // 予約されないので、キューは Queued のまま残る。
    expect(
      database.getSql(
        "SELECT status FROM content_enrichment_queue WHERE owner_id = ?",
        [ownerA]
      )
    ).toMatchObject({ status: "Queued" })
  })

  it("enqueues a single owned article as a reprocess and refuses while it is processing", async () => {
    const { queue } = await setup()

    expect(
      await Effect.runPromise(queue.enqueueOne(ownerA, articleId, now))
    ).toEqual({ _tag: "Enqueued" })
    const queued = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(queued.pending).toMatchObject({
      count: 1,
      items: [{ reason: "Reprocess", status: "Queued", attempt: 0 }],
    })

    await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )
    expect(
      await Effect.runPromise(queue.enqueueOne(ownerA, articleId, later))
    ).toEqual({ _tag: "Processing" })
  })

  it("reports and resets the daily budget for one owner and local date only", async () => {
    const { database, queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )
    await Effect.runPromise(
      queue.reserveAttempt(ownerA, claim!, now, "2026-08-13", 200)
    )
    await Effect.runPromise(queue.completeSuccess(ownerA, claim!, output, now))

    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-13"))
    ).toBe(1)
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-14"))
    ).toBe(0)

    database.runSql(
      `INSERT INTO content_enrichment_daily_progress
        (owner_id, local_date, processed_count) VALUES (?, ?, ?)`,
      [ownerB, "2026-08-13", 3]
    )

    await Effect.runPromise(queue.resetDaily(ownerA, "2026-08-14"))
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-13"))
    ).toBe(1)
    await Effect.runPromise(queue.resetDaily(ownerA, "2026-08-13"))
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerA, "2026-08-13"))
    ).toBe(0)
    expect(
      await Effect.runPromise(queue.budgetUsed(ownerB, "2026-08-13"))
    ).toBe(3)
  })

  it("isolates the daily budget between owners", async () => {
    const { queue } = await setup()
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )
    await Effect.runPromise(
      queue.reserveAttempt(ownerA, claim!, now, "2026-08-13", 200)
    )
    await Effect.runPromise(queue.completeSuccess(ownerA, claim!, output, now))

    expect(
      (await Effect.runPromise(queue.status(ownerA, 200, "2026-08-13"))).daily
        .used
    ).toBe(1)
    expect(
      (await Effect.runPromise(queue.status(ownerB, 200, "2026-08-13"))).daily
        .used
    ).toBe(0)
  })

  it("replaces AI tags with known vocabulary and records unknown names as suggestions", async () => {
    const { database, queue } = await setup()
    database.runSql(
      "INSERT INTO content_tags(tag_id, owner_id, name, created_at) VALUES (?, ?, ?, ?)",
      ["tag-known", ownerA, "ai", now]
    )
    database.runSql(
      `INSERT INTO content_article_tags
        (owner_id, article_id, tag_id, source, confidence, created_at)
       VALUES (?, ?, ?, 'Ai', 1, ?)`,
      [ownerA, articleId, "tag-known", now]
    )
    await Effect.runPromise(queue.reconcile(now))
    const [claim] = await Effect.runPromise(
      queue.claim(ownerA, 1, now, expires, "lease-token-0001")
    )

    await Effect.runPromise(
      queue.completeSuccess(
        ownerA,
        claim!,
        {
          ...output,
          tags: ["ai", "unknown-tag"],
          // 同じ未知の名前を重ねても、候補は1件としてだけ数える。
          suggestedTags: ["ai", "fresh", "fresh"],
        } as never,
        now
      )
    )

    expect(
      database.allSql(
        "SELECT tag_id AS tagId FROM content_article_tags WHERE owner_id = ? AND source = 'Ai'",
        [ownerA]
      )
    ).toEqual([{ tagId: "tag-known" }])
    expect(
      database.allSql(
        "SELECT name, occurrences FROM content_tag_suggestions WHERE owner_id = ?",
        [ownerA]
      )
    ).toEqual([{ name: "fresh", occurrences: 1 }])
  })
})
