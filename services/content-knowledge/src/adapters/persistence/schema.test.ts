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
  "content_outbox",
  "feed_sync_jobs",
  "content_interest_profiles",
  "content_tags",
  "content_article_tags",
  "content_tag_suggestions",
  "content_enrichment_results",
  "content_enrichment_queue",
  "content_enrichment_daily_progress",
]

/**
 * drizzle-kitはSTRICTを生成できず、マイグレーションSQLへ手で追記している。
 * 再生成で静かに失われると型の緩みに気づけないため、ここで固定する。
 */
describe("content-knowledge migrated schema", () => {
  it.each(TABLES)("declares %s as STRICT", (table) => {
    expect(schemaSql().get(table)).toContain("STRICT")
  })

  it("keeps the outbox pending index partial so published rows drop out", () => {
    expect(schemaSql().get("content_outbox_pending")).toContain(
      'published_at" IS NULL'
    )
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
