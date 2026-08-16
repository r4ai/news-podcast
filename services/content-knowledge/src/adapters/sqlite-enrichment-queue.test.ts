import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { CapturedAtSchema } from "../domain/article.js"
import type { EnrichmentProviderOutput } from "../domain/enrichment.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { openTestDatabase, type TestDatabase } from "./persistence/testing.js"
import { createEnrichmentQueue } from "./persistence/enrichment-queue/repository.js"

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

const setup = async () => {
  const database = openTestDatabase()
  databases.push(database)
  database.execSql(`
    INSERT INTO feed_catalog VALUES ('feed-a', 'https://a.example/feed', '${now}');
    INSERT INTO feed_catalog VALUES ('feed-b', 'https://b.example/feed', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('sub-a', 'owner-a', 'feed-a', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('sub-b', 'owner-b', 'feed-b', '${now}');
    INSERT INTO feed_items VALUES ('${articleId}', 'feed-a', 'a', 'https://a.example/a', 'A', NULL, '${now}');
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

    await Effect.runPromise(
      queue.completeSuccess(ownerA, claim!, output, now, "2026-08-13")
    )
    const after = await Effect.runPromise(
      queue.status(ownerA, 200, "2026-08-13")
    )
    expect(after.processing).toHaveLength(0)
    expect(after.recent[0]).toMatchObject({ status: "Succeeded" })
    expect(after.daily).toEqual({ used: 1, limit: 200 })
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
          now,
          "2026-08-13"
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
      queue.completeSuccess(ownerA, claim!, output, now, "2026-08-13")
    )

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
      queue.completeSuccess(ownerA, claim!, output, now, "2026-08-13")
    )

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
        now,
        "2026-08-13"
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
