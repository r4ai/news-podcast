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
  },
  (table) => [
    unique("episode_jobs_owner_idempotency").on(
      table.ownerId,
      table.idempotencyKey
    ),
    // 実行待ちの探索。式インデックスを置き換える。
    index("episode_jobs_execution_state").on(table.status, table.jobId),
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

/**
 * 状態遷移の記録。以前は episode_jobs のトリガが materialize していたが、
 * 遷移を書く側が同一トランザクションで明示的に積む。
 * イベントは不変なので、その時点の姿を payload として保持する。
 */
export const episodeJobStatusEvents = sqliteTable(
  "episode_job_status_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    occurredAt: text("occurred_at").notNull(),
    document: text("document").notNull(),
  },
  (table) => [
    index("episode_job_status_events_owner_cursor").on(
      table.ownerId,
      table.jobId,
      table.sequence
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

// ---------------------------------------------------------------------------
// エージェント監査
// ---------------------------------------------------------------------------

export const productionAgentInstances = sqliteTable(
  "production_agent_instances",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    agentKey: text("agent_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("production_agent_instances_owner_key").on(
      table.ownerId,
      table.agentKey
    ),
  ]
)

export const productionAgentRuns = sqliteTable(
  "production_agent_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => episodeJobs.jobId, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    agentInstanceId: text("agent_instance_id").references(
      () => productionAgentInstances.id,
      { onDelete: "set null" }
    ),
    model: text("model").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "retrying",
        "succeeded",
        "failed",
        "canceled",
      ],
    }).notNull(),
    policyHash: text("policy_hash").notNull(),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
    failureCode: text("failure_code"),
  },
  (table) => [
    index("production_agent_runs_owner_status").on(
      table.ownerId,
      table.status,
      sql`${table.createdAt} DESC`,
      table.id
    ),
    check(
      "production_agent_runs_status_check",
      sql`${table.status} IN ('queued', 'running', 'waiting_approval', 'retrying', 'succeeded', 'failed', 'canceled')`
    ),
  ]
)

export const productionAgentEvents = sqliteTable(
  "production_agent_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => productionAgentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sequence] }),
    check(
      "production_agent_events_sequence_check",
      sql`${table.sequence} >= 0`
    ),
    check(
      "production_agent_events_payload_check",
      sql`json_valid(${table.payloadJson})`
    ),
  ]
)

export const productionAgentMemories = sqliteTable(
  "production_agent_memories",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    agentInstanceId: text("agent_instance_id")
      .notNull()
      .references(() => productionAgentInstances.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["preference", "episode_history", "working_note"],
    }).notNull(),
    status: text("status", {
      enum: ["proposed", "active", "rejected", "deleted"],
    }).notNull(),
    currentVersion: integer("current_version").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("production_agent_memories_scope").on(
      table.ownerId,
      table.agentInstanceId,
      table.status,
      table.kind,
      table.id
    ),
    check(
      "production_agent_memories_kind_check",
      sql`${table.kind} IN ('preference', 'episode_history', 'working_note')`
    ),
    check(
      "production_agent_memories_status_check",
      sql`${table.status} IN ('proposed', 'active', 'rejected', 'deleted')`
    ),
    check(
      "production_agent_memories_version_check",
      sql`${table.currentVersion} >= 1`
    ),
  ]
)

export const productionAgentMemoryVersions = sqliteTable(
  "production_agent_memory_versions",
  {
    memoryId: text("memory_id")
      .notNull()
      .references(() => productionAgentMemories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentJson: text("content_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.version] }),
    check(
      "production_agent_memory_versions_version_check",
      sql`${table.version} >= 1`
    ),
    check(
      "production_agent_memory_versions_content_check",
      sql`json_valid(${table.contentJson})`
    ),
  ]
)
