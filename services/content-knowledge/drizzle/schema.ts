import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

// ---------------------------------------------------------------------------
// 購読とフィード
// ---------------------------------------------------------------------------

export const feedCatalog = sqliteTable("feed_catalog", {
  feedId: text("feed_id").primaryKey(),
  feedUrl: text("feed_url").notNull().unique(),
  createdAt: text("created_at").notNull(),
})

export const feedSubscriptions = sqliteTable(
  "feed_subscriptions",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    feedId: text("feed_id")
      .notNull()
      .references(() => feedCatalog.feedId, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    enabled: integer("enabled").notNull().default(1),
  },
  (table) => [
    unique("feed_subscriptions_owner_feed").on(table.ownerId, table.feedId),
    index("feed_subscriptions_owner").on(
      table.ownerId,
      table.createdAt,
      table.subscriptionId
    ),
    check("feed_subscriptions_enabled_check", sql`${table.enabled} IN (0, 1)`),
  ]
)

export const feedItems = sqliteTable(
  "feed_items",
  {
    articleId: text("article_id").primaryKey(),
    feedId: text("feed_id")
      .notNull()
      .references(() => feedCatalog.feedId, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    publishedAt: text("published_at"),
    discoveredAt: text("discovered_at").notNull(),
  },
  (table) => [
    unique("feed_items_feed_external").on(table.feedId, table.externalId),
    index("feed_items_latest").on(
      table.feedId,
      sql`${table.publishedAt} DESC`,
      sql`${table.discoveredAt} DESC`,
      sql`${table.articleId} DESC`
    ),
  ]
)

export const articleOwnerStates = sqliteTable(
  "article_owner_states",
  {
    ownerId: text("owner_id").notNull(),
    articleId: text("article_id")
      .notNull()
      .references(() => feedItems.articleId, { onDelete: "cascade" }),
    read: integer("read").notNull().default(0),
    saved: integer("saved").notNull().default(0),
    readLater: integer("read_later").notNull().default(0),
    hidden: integer("hidden").notNull().default(0),
    hiddenAt: text("hidden_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.articleId] }),
    index("article_owner_states_owner").on(
      table.ownerId,
      table.updatedAt,
      table.articleId
    ),
    check("article_owner_states_read_check", sql`${table.read} IN (0, 1)`),
    check("article_owner_states_saved_check", sql`${table.saved} IN (0, 1)`),
    check(
      "article_owner_states_read_later_check",
      sql`${table.readLater} IN (0, 1)`
    ),
    check("article_owner_states_hidden_check", sql`${table.hidden} IN (0, 1)`),
  ]
)

// ---------------------------------------------------------------------------
// アーカイブと送信アウトボックス
// ---------------------------------------------------------------------------

export const articleSnapshots = sqliteTable(
  "article_snapshots",
  {
    archiveRequestId: text("archive_request_id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().unique(),
    /**
     * 以前は snapshot_json から json_extract で取り出しており、
     * 記事一覧の結合キーが式に依存していた。実カラムへ引き上げて
     * 「記事ごとの最新スナップショット」を索引で解けるようにする。
     */
    articleId: text("article_id").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    index("article_snapshots_latest").on(
      table.articleId,
      sql`${table.capturedAt} DESC`,
      sql`${table.snapshotId} DESC`
    ),
  ]
)

export const contentOutbox = sqliteTable(
  "content_outbox",
  {
    messageId: text("message_id").primaryKey(),
    archiveRequestId: text("archive_request_id")
      .notNull()
      .unique()
      .references(() => articleSnapshots.archiveRequestId, {
        onDelete: "cascade",
      }),
    subject: text("subject").notNull(),
    envelopeJson: text("envelope_json").notNull(),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    // 未送信分だけを走査する。部分インデックスなので送信済みの行は index に載らない。
    index("content_outbox_pending")
      .on(table.createdAt, table.messageId)
      .where(sql`${table.publishedAt} IS NULL`),
  ]
)

// ---------------------------------------------------------------------------
// フィード同期キュー
// ---------------------------------------------------------------------------

export const feedSyncJobs = sqliteTable(
  "feed_sync_jobs",
  {
    jobId: text("job_id").primaryKey(),
    feedId: text("feed_id")
      .notNull()
      .unique()
      .references(() => feedCatalog.feedId, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["Queued", "Processing", "Succeeded", "Failed"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseExpiresAt: text("lease_expires_at"),
    discovered: integer("discovered").notNull().default(0),
    archived: integer("archived").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("feed_sync_jobs_claim").on(
      table.status,
      table.createdAt,
      table.jobId
    ),
    check(
      "feed_sync_jobs_status_check",
      sql`${table.status} IN ('Queued', 'Processing', 'Succeeded', 'Failed')`
    ),
    check(
      "feed_sync_jobs_attempt_check",
      sql`${table.attempt} >= 0 AND ${table.attempt} <= 4`
    ),
    check("feed_sync_jobs_discovered_check", sql`${table.discovered} >= 0`),
    check("feed_sync_jobs_archived_check", sql`${table.archived} >= 0`),
    check("feed_sync_jobs_failed_check", sql`${table.failed} >= 0`),
  ]
)

// ---------------------------------------------------------------------------
// 関心プロファイル
// ---------------------------------------------------------------------------

export const contentInterestProfiles = sqliteTable(
  "content_interest_profiles",
  {
    ownerId: text("owner_id").primaryKey(),
    includeTopics: text("include_topics").notNull(),
    excludeTopics: text("exclude_topics").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
)

// ---------------------------------------------------------------------------
// タグ語彙
// ---------------------------------------------------------------------------

export const contentTags = sqliteTable(
  "content_tags",
  {
    tagId: text("tag_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("content_tags_owner_name").on(table.ownerId, table.name),
    // 記事タグからの複合外部キーが参照するため、この一意制約は必須。
    uniqueIndex("content_tags_owner_tag").on(table.ownerId, table.tagId),
  ]
)

export const contentArticleTags = sqliteTable(
  "content_article_tags",
  {
    ownerId: text("owner_id").notNull(),
    articleId: text("article_id")
      .notNull()
      .references(() => feedItems.articleId, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull(),
    source: text("source", { enum: ["Manual", "Ai"] }).notNull(),
    confidence: real("confidence"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.articleId, table.tagId] }),
    foreignKey({
      columns: [table.ownerId, table.tagId],
      foreignColumns: [contentTags.ownerId, contentTags.tagId],
      name: "content_article_tags_tag_fk",
    }).onDelete("cascade"),
    index("content_article_tags_article").on(
      table.ownerId,
      table.articleId,
      table.source
    ),
    check(
      "content_article_tags_source_check",
      sql`${table.source} IN ('Manual', 'Ai')`
    ),
    check(
      "content_article_tags_confidence_check",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`
    ),
  ]
)

export const contentTagSuggestions = sqliteTable(
  "content_tag_suggestions",
  {
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.name] }),
    check(
      "content_tag_suggestions_occurrences_check",
      sql`${table.occurrences} > 0`
    ),
  ]
)

// ---------------------------------------------------------------------------
// AI補完キュー
// ---------------------------------------------------------------------------

export const contentEnrichmentResults = sqliteTable(
  "content_enrichment_results",
  {
    ownerId: text("owner_id").notNull(),
    articleId: text("article_id")
      .notNull()
      .references(() => feedItems.articleId, { onDelete: "cascade" }),
    status: text("status", { enum: ["Succeeded", "Failed"] }).notNull(),
    summary: text("summary"),
    score: integer("score"),
    reason: text("reason"),
    error: text("error"),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.articleId] }),
    check(
      "content_enrichment_results_status_check",
      sql`${table.status} IN ('Succeeded', 'Failed')`
    ),
    check(
      "content_enrichment_results_score_check",
      sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`
    ),
    check(
      "content_enrichment_results_tokens_in_check",
      sql`${table.tokensIn} >= 0`
    ),
    check(
      "content_enrichment_results_tokens_out_check",
      sql`${table.tokensOut} >= 0`
    ),
  ]
)

export const contentEnrichmentQueue = sqliteTable(
  "content_enrichment_queue",
  {
    ownerId: text("owner_id").notNull(),
    articleId: text("article_id")
      .notNull()
      .references(() => feedItems.articleId, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    reason: text("reason", { enum: ["New", "Reprocess"] }).notNull(),
    status: text("status", {
      enum: ["Queued", "Processing", "Succeeded", "Failed"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.articleId] }),
    index("content_enrichment_queue_claim").on(
      table.ownerId,
      table.status,
      table.priority,
      table.publishedAt,
      table.createdAt
    ),
    check(
      "content_enrichment_queue_reason_check",
      sql`${table.reason} IN ('New', 'Reprocess')`
    ),
    check(
      "content_enrichment_queue_status_check",
      sql`${table.status} IN ('Queued', 'Processing', 'Succeeded', 'Failed')`
    ),
    check("content_enrichment_queue_attempt_check", sql`${table.attempt} >= 0`),
  ]
)

export const contentEnrichmentDailyProgress = sqliteTable(
  "content_enrichment_daily_progress",
  {
    localDate: text("local_date").primaryKey(),
    processedCount: integer("processed_count").notNull().default(0),
  },
  (table) => [
    check(
      "content_enrichment_daily_progress_count_check",
      sql`${table.processedCount} >= 0`
    ),
  ]
)
