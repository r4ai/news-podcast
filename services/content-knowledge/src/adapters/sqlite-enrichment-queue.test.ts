import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { CapturedAtSchema } from "../domain/article.js"
import type { EnrichmentProviderOutput } from "../domain/enrichment.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { createSqliteEnrichmentQueue } from "./sqlite-enrichment-queue.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const databases: ReturnType<typeof openSqliteUnsafe>[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const now = decode(CapturedAtSchema, "2026-08-13T01:00:00.000Z")
const later = decode(CapturedAtSchema, "2026-08-13T01:20:00.000Z")
const expires = decode(CapturedAtSchema, "2026-08-13T01:10:00.000Z")
const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never

const setup = async () => {
  const database = openSqliteUnsafe(":memory:")
  databases.push(database)
  database.execute(`
    CREATE TABLE feed_catalog (
      feed_id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE feed_subscriptions (
      subscription_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
      feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id), created_at TEXT NOT NULL,
      UNIQUE(owner_id, feed_id)
    ) STRICT;
    CREATE TABLE feed_items (
      article_id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id),
      external_id TEXT NOT NULL, source_url TEXT NOT NULL, title TEXT NOT NULL,
      published_at TEXT, discovered_at TEXT NOT NULL, UNIQUE(feed_id, external_id)
    ) STRICT;
    CREATE TABLE article_snapshots (
      archive_request_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL UNIQUE,
      snapshot_json TEXT NOT NULL, captured_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO feed_catalog VALUES ('feed-a', 'https://a.example/feed', '${now}');
    INSERT INTO feed_catalog VALUES ('feed-b', 'https://b.example/feed', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('sub-a', 'owner-a', 'feed-a', '${now}');
    INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at) VALUES ('sub-b', 'owner-b', 'feed-b', '${now}');
    INSERT INTO feed_items VALUES ('${articleId}', 'feed-a', 'a', 'https://a.example/a', 'A', NULL, '${now}');
    INSERT INTO article_snapshots VALUES (
      'request-a', 'snapshot-a',
      '{"articleId":"${articleId}","capture":{"markdown":{"key":"articles/a/article.md"}}}',
      '${now}'
    );
  `)
  return {
    database,
    queue: await Effect.runPromise(createSqliteEnrichmentQueue(database)),
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
})
