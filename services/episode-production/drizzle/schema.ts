import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core"

// ---------------------------------------------------------------------------
// エピソード生成ジョブ
// ---------------------------------------------------------------------------

const JOB_STATUSES = [
  "Queued",
  "Running",
  "Retrying",
  "Succeeded",
  "Failed",
  "Canceled",
] as const

/**
 * 以前は状態機械の全体を document(JSON) 1列に押し込み、
 * `json_extract(document,'$._tag')` と式インデックスでしか状態を扱えなかった。
 * 状態と時刻を実カラムへ分解し、遷移がコード上でもSQL上でも追えるようにする。
 */
export const episodeJobs = sqliteTable(
  "episode_jobs",
  {
    jobId: text("job_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    idempotencyScope: text("idempotency_scope").notNull().default("create"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),

    status: text("status", { enum: JOB_STATUSES }).notNull(),
    attempt: integer("attempt").notNull(),

    createdAt: text("created_at").notNull(),
    enqueuedAt: text("enqueued_at"),
    startedAt: text("started_at"),
    retryAt: text("retry_at"),
    completedAt: text("completed_at"),
    failedAt: text("failed_at"),
    canceledAt: text("canceled_at"),

    leaseToken: text("lease_token"),
    leasedUntil: text("leased_until"),

    failureCode: text("failure_code"),
    failureRetryable: integer("failure_retryable"),
    episodeId: text("episode_id"),
    cancelReason: text("cancel_reason", {
      enum: ["requested_by_user", "service_shutdown"],
    }),
    currentStage: text("current_stage", {
      enum: [
        "selecting_articles",
        "materializing_articles",
        "generating_script",
        "preparing_pronunciation",
        "synthesizing_audio",
        "storing_episode",
      ],
    }),
    stageStartedAt: text("stage_started_at"),
    lastProgressAt: text("last_progress_at"),
    stageProgressCompleted: integer("stage_progress_completed"),
    stageProgressTotal: integer("stage_progress_total"),
  },
  (table) => [
    unique("episode_jobs_owner_scope_idempotency").on(
      table.ownerId,
      table.idempotencyScope,
      table.idempotencyKey
    ),
    // lease優先度、状態ごとのready時刻、決定的tie-breakerをqueryと共有する。
    index("episode_jobs_execution_priority").on(
      sql`CASE ${table.status}
            WHEN 'Running' THEN 0
            WHEN 'Retrying' THEN 1
            WHEN 'Queued' THEN 2
            ELSE 3
          END`,
      sql`CASE ${table.status}
            WHEN 'Running' THEN ${table.leasedUntil}
            WHEN 'Retrying' THEN ${table.retryAt}
            WHEN 'Queued' THEN ${table.enqueuedAt}
            ELSE ${table.createdAt}
          END`,
      table.jobId
    ),
    // 所有者ごとの新しい順。以前は rowid 順に暗黙依存していた。
    index("episode_jobs_owner_recent").on(
      table.ownerId,
      sql`${table.createdAt} DESC`,
      sql`${table.jobId} DESC`
    ),
    check(
      "episode_jobs_status_check",
      sql`${table.status} IN ('Queued', 'Running', 'Retrying', 'Succeeded', 'Failed', 'Canceled')`
    ),
    check(
      "episode_jobs_attempt_check",
      sql`${table.attempt} >= 0 AND ${table.attempt} <= 4`
    ),
    // 状態ごとに揃っているべき列を、テーブル側でも拘束する。
    check(
      "episode_jobs_running_lease_check",
      sql`${table.status} <> 'Running' OR (${table.leaseToken} IS NOT NULL AND ${table.leasedUntil} IS NOT NULL AND ${table.startedAt} IS NOT NULL)`
    ),
    check(
      "episode_jobs_succeeded_check",
      sql`${table.status} <> 'Succeeded' OR (${table.episodeId} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`
    ),
    check(
      "episode_jobs_failed_check",
      sql`${table.status} <> 'Failed' OR (${table.failureCode} IS NOT NULL AND ${table.failedAt} IS NOT NULL)`
    ),
    check(
      "episode_jobs_retrying_check",
      sql`${table.status} <> 'Retrying' OR (${table.failureCode} IS NOT NULL AND ${table.retryAt} IS NOT NULL)`
    ),
    check(
      "episode_jobs_canceled_check",
      sql`${table.status} <> 'Canceled' OR (${table.canceledAt} IS NOT NULL AND ${table.cancelReason} IS NOT NULL)`
    ),
    check(
      "episode_jobs_stage_progress_check",
      sql`(${table.stageProgressCompleted} IS NULL AND ${table.stageProgressTotal} IS NULL) OR (${table.stageProgressCompleted} >= 0 AND ${table.stageProgressTotal} > 0 AND ${table.stageProgressCompleted} <= ${table.stageProgressTotal})`
    ),
  ]
)

/** 依頼で明示的に選ばれた記事。順序が冪等キーに影響するため位置を持つ。 */
export const episodeJobArticles = sqliteTable(
  "episode_job_articles",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    articleId: text("article_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.position] }),
    check("episode_job_articles_position_check", sql`${table.position} >= 0`),
  ]
)

/** Latest preferences and ordered articles are frozen once, before materialization. */
export const episodeGenerationPlans = sqliteTable(
  "episode_generation_plans",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    selectionMode: text("selection_mode", {
      enum: ["automatic", "manual"],
    }).notNull(),
    profileInclude: text("profile_include").notNull(),
    profileExclude: text("profile_exclude").notNull(),
    selectedArticleIds: text("selected_article_ids").notNull(),
    selectedArticles: text("selected_articles").notNull().default("[]"),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "episode_generation_plans_selection_mode_check",
      sql`${table.selectionMode} IN ('automatic', 'manual')`
    ),
    check(
      "episode_generation_plans_article_ids_json_check",
      sql`json_valid(${table.selectedArticleIds}) AND json_array_length(${table.selectedArticleIds}) BETWEEN 1 AND 20`
    ),
  ]
)

/** Durable, replayable AG-UI wire events. */
export const episodeJobAguiEvents = sqliteTable(
  "episode_job_agui_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    runId: text("run_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: text("occurred_at").notNull(),
    payload: text("payload").notNull(),
    eventKey: text("event_key").notNull().unique(),
  },
  (table) => [
    index("episode_job_agui_events_owner_cursor").on(
      table.ownerId,
      table.jobId,
      table.sequence
    ),
    check(
      "episode_job_agui_events_payload_check",
      sql`json_valid(${table.payload})`
    ),
  ]
)

export const episodeExecutionCheckpoints = sqliteTable(
  "episode_execution_checkpoints",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    script: text("script").notNull(),
    audio: text("audio"),
  }
)

export const episodeDictionarySnapshots = sqliteTable(
  "episode_dictionary_snapshots",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    snapshot: text("snapshot").notNull(),
  }
)

export const episodeCompletionOutbox = sqliteTable(
  "episode_completion_outbox",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    episodeId: text("episode_id").notNull().unique(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("episode_completion_outbox_pending").on(
      table.publishedAt,
      table.createdAt
    ),
  ]
)

// ---------------------------------------------------------------------------
// 読み辞書
// ---------------------------------------------------------------------------

export const readingDictionary = sqliteTable(
  "reading_dictionary",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    surface: text("surface").notNull(),
    reading: text("reading").notNull(),
    accentType: integer("accent_type").notNull(),
    source: text("source", { enum: ["manual", "ai_auto"] }).notNull(),
    episodeJobId: text("episode_job_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("reading_dictionary_owner_surface_unique").on(
      table.ownerId,
      table.surface
    ),
    index("reading_dictionary_owner_surface").on(
      table.ownerId,
      table.surface,
      table.id
    ),
    check(
      "reading_dictionary_accent_type_check",
      sql`${table.accentType} BETWEEN 0 AND 100`
    ),
    check(
      "reading_dictionary_source_check",
      sql`${table.source} IN ('manual', 'ai_auto')`
    ),
  ]
)
