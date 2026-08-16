import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { describe, expect, it } from "vitest"

import { openTestDatabase } from "./testing.js"

const schemaSql = (): ReadonlyMap<string, string> => {
  const database = openTestDatabase()
  try {
    const rows = database.allSql(
      "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL"
    ) as readonly { readonly name: string; readonly sql: string }[]
    return new Map(rows.map((row) => [row.name, row.sql]))
  } finally {
    database.close()
  }
}

const TABLES = [
  "feed_catalog",
  "feed_subscriptions",
  "feed_items",
  "article_owner_states",
  "article_snapshots",
  "feed_sync_jobs",
  "content_interest_profiles",
  "content_tags",
  "content_article_tags",
  "content_tag_suggestions",
  "content_enrichment_results",
  "content_enrichment_queue",
  "content_enrichment_daily_progress",
]

const readMigration = (directory: string): string =>
  readFileSync(
    new URL(
      `../../../drizzle/migrations/${directory}/migration.sql`,
      import.meta.url
    ),
    "utf8"
  ).replaceAll("--> statement-breakpoint", "")

/**
 * drizzle-kitはSTRICTを生成できず、マイグレーションSQLへ手で追記している。
 * 再生成で静かに失われると型の緩みに気づけないため、ここで固定する。
 */
describe("content-knowledge migrated schema", () => {
  it.each(TABLES)("declares %s as STRICT", (table) => {
    expect(schemaSql().get(table)).toContain("STRICT")
  })

  it("does not retain the retired content outbox", () => {
    expect(schemaSql().has("content_outbox")).toBe(false)
    expect(schemaSql().has("content_outbox_pending")).toBe(false)
  })

  it("drops only the outbox when upgrading an existing content database", () => {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(readMigration("20260815015622_init"))
      database.exec(readMigration("20260815070952_sudden_leo"))
      database.exec(`
        INSERT INTO feed_catalog (feed_id, feed_url, created_at)
        VALUES ('feed-1', 'https://example.test/feed.xml', '2026-08-15T00:00:00Z');
        INSERT INTO feed_subscriptions
          (subscription_id, owner_id, feed_id, created_at, enabled)
        VALUES ('subscription-1', 'owner-1', 'feed-1', '2026-08-15T00:00:00Z', 1);
        INSERT INTO article_snapshots
          (archive_request_id, snapshot_id, article_id, snapshot_json, captured_at)
        VALUES ('archive-1', 'snapshot-1', 'article-1', '{}', '2026-08-15T00:00:00Z');
        INSERT INTO content_tag_suggestions
          (owner_id, name, occurrences, last_seen_at)
        VALUES ('owner-1', 'reliability', 2, '2026-08-15T00:00:00Z');
        INSERT INTO content_outbox
          (message_id, archive_request_id, subject, envelope_json, created_at)
        VALUES ('message-1', 'archive-1', 'content.article-archived.v1', '{}',
          '2026-08-15T00:00:00Z');
      `)

      database.exec(readMigration("20260815135150_jittery_makkari"))

      expect(
        database
          .prepare("SELECT count(*) AS count FROM article_snapshots")
          .get()
      ).toEqual({ count: 1 })
      expect(
        database
          .prepare("SELECT count(*) AS count FROM feed_subscriptions")
          .get()
      ).toEqual({ count: 1 })
      expect(
        database
          .prepare("SELECT count(*) AS count FROM content_tag_suggestions")
          .get()
      ).toEqual({ count: 1 })
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'content_outbox'"
          )
          .get()
      ).toEqual({ count: 0 })
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      })
    } finally {
      database.close()
    }
  })

  it("migrates the global enrichment allowance to an empty owner-scoped allowance", () => {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(readMigration("20260815015622_init"))
      database.exec(`
        INSERT INTO content_enrichment_daily_progress
          (local_date, processed_count)
        VALUES ('2026-08-16', 17);
      `)

      database.exec(readMigration("20260816162331_eminent_forge"))

      expect(
        database
          .prepare(
            "SELECT owner_id, local_date, processed_count FROM content_enrichment_daily_progress"
          )
          .all()
      ).toEqual([])
      expect(schemaSql().get("content_enrichment_daily_progress")).toContain(
        "PRIMARY KEY(`owner_id`, `local_date`)"
      )
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      })
    } finally {
      database.close()
    }
  })

  it("keeps the composite foreign key from article tags to the owner vocabulary", () => {
    const sql = schemaSql().get("content_article_tags") ?? ""

    expect(sql).toContain("FOREIGN KEY (`owner_id`,`tag_id`)")
    expect(sql).toContain("ON DELETE CASCADE")
  })

  it("constrains the subscription enabled flag to the boolean encoding", () => {
    expect(schemaSql().get("feed_subscriptions")).toContain(
      `CHECK("enabled" IN (0, 1))`
    )
  })

  it("caps sync attempts in the table, not only in the worker", () => {
    expect(schemaSql().get("feed_sync_jobs")).toContain(
      `CHECK("attempt" >= 0 AND "attempt" <= 4)`
    )
  })

  it("indexes the latest snapshot lookup that replaced json_extract", () => {
    expect(schemaSql().get("article_snapshots_latest")).toContain("article_id")
  })
})
