import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

/**
 * 冪等な取り込みのための受信簿。
 * 同じmessage_idが異なる内容で再送された場合は、取り込まずに矛盾として扱う。
 */
export const episodeCompletionInbox = sqliteTable("episode_completion_inbox", {
  messageId: text("message_id").primaryKey(),
  episodeId: text("episode_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  receivedAt: text("received_at").notNull(),
})

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    script: text("script").notNull(),
    audioObjectKey: text("audio_object_key").notNull(),
    audioByteLength: integer("audio_byte_length").notNull(),
    audioContentType: text("audio_content_type", {
      enum: ["audio/wav", "audio/mpeg"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // キーセットページングの走査順と一致させる。
    index("episodes_owner_created_idx").on(
      table.ownerId,
      sql`${table.createdAt} DESC`,
      sql`${table.id} DESC`
    ),
    check(
      "episodes_audio_byte_length_check",
      sql`${table.audioByteLength} > 0`
    ),
    check(
      "episodes_audio_content_type_check",
      sql`${table.audioContentType} IN ('audio/wav', 'audio/mpeg')`
    ),
  ]
)

export const episodeSources = sqliteTable(
  "episode_sources",
  {
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceKind: text("source_kind", { enum: ["rss", "web"] }).notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publishedAt: text("published_at"),
    snapshotId: text("snapshot_id"),
  },
  (table) => [
    primaryKey({ columns: [table.episodeId, table.position] }),
    check("episode_sources_position_check", sql`${table.position} >= 0`),
    check(
      "episode_sources_kind_check",
      sql`${table.sourceKind} IN ('rss', 'web')`
    ),
    // 出典の種別ごとに、あり得る欠損の形を1箇所で拘束する。
    check(
      "episode_sources_provenance_check",
      sql`(${table.sourceKind} = 'rss' AND ${table.snapshotId} IS NOT NULL) OR (${table.sourceKind} = 'web' AND ${table.snapshotId} IS NULL AND ${table.publishedAt} IS NULL)`
    ),
  ]
)
