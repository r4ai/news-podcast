#!/usr/bin/env node
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { backup, DatabaseSync } from "node:sqlite"

const profiles = ["identity", "content", "production", "library"]
const targetNames = Object.freeze({
  identity: "identity.sqlite",
  content: "content.sqlite",
  production: "production.sqlite",
  library: "library.sqlite",
})

const requiredSourceTables = Object.freeze([
  "account",
  "agent_events",
  "agent_instances",
  "agent_memories",
  "agent_memory_versions",
  "agent_approval_requests",
  "agent_runs",
  "agent_tool_calls",
  "ai_enrich_daily_progress",
  "article_relevance",
  "article_snapshots",
  "article_summaries",
  "article_tags",
  "article_user_states",
  "archive_assets",
  "enrich_queue",
  "episode_audio_chunks",
  "episode_job_articles",
  "episode_job_drafts",
  "episode_jobs",
  "episode_sources",
  "episodes",
  "feed_catalog",
  "feed_items",
  "feed_subscriptions",
  "reading_dictionary",
  "session",
  "tag_suggestions",
  "tags",
  "user",
  "user_settings",
  "verification",
])

const targetSchemas = Object.freeze({
  identity: `
    PRAGMA foreign_keys=ON;
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
    CREATE INDEX session_user_id_idx ON session(userId);
    CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE INDEX account_user_id_idx ON account(userId);
    CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
    CREATE INDEX verification_identifier_idx ON verification(identifier);
    CREATE TABLE user_settings (owner_id TEXT PRIMARY KEY, schedule_enabled INTEGER NOT NULL DEFAULT 0 CHECK(schedule_enabled IN (0,1)), schedule_local_time TEXT NOT NULL, schedule_time_zone TEXT NOT NULL, last_scheduled_local_date TEXT) STRICT;
  `,
  content: `
    PRAGMA foreign_keys=ON;
    CREATE TABLE feed_catalog (feed_id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE feed_subscriptions (subscription_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id) ON DELETE CASCADE, created_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), UNIQUE(owner_id,feed_id)) STRICT;
    CREATE INDEX feed_subscriptions_owner ON feed_subscriptions(owner_id,created_at,subscription_id);
    CREATE TABLE feed_items (article_id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id) ON DELETE CASCADE, external_id TEXT NOT NULL, source_url TEXT NOT NULL, title TEXT NOT NULL, published_at TEXT, discovered_at TEXT NOT NULL, UNIQUE(feed_id,external_id)) STRICT;
    CREATE INDEX feed_items_latest ON feed_items(feed_id,published_at DESC,discovered_at DESC,article_id DESC);
    CREATE TABLE article_owner_states (owner_id TEXT NOT NULL, article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE, read INTEGER NOT NULL DEFAULT 0 CHECK(read IN (0,1)), saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0,1)), read_later INTEGER NOT NULL DEFAULT 0 CHECK(read_later IN (0,1)), hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), hidden_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,article_id)) STRICT;
    CREATE INDEX article_owner_states_owner ON article_owner_states(owner_id,updated_at,article_id);
    CREATE TABLE article_snapshots (archive_request_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), captured_at TEXT NOT NULL) STRICT;
    CREATE TABLE content_outbox (message_id TEXT PRIMARY KEY, archive_request_id TEXT NOT NULL UNIQUE REFERENCES article_snapshots(archive_request_id) ON DELETE CASCADE, subject TEXT NOT NULL, envelope_json TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT) STRICT;
    CREATE TABLE content_interest_profiles (owner_id TEXT PRIMARY KEY, include_topics TEXT NOT NULL, exclude_topics TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE content_tags (tag_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,name), UNIQUE(owner_id,tag_id)) STRICT;
    CREATE TABLE content_article_tags (owner_id TEXT NOT NULL, article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE, tag_id TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('Manual','Ai')), confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)), created_at TEXT NOT NULL, PRIMARY KEY(owner_id,article_id,tag_id), FOREIGN KEY(owner_id,tag_id) REFERENCES content_tags(owner_id,tag_id) ON DELETE CASCADE) STRICT;
    CREATE TABLE content_tag_suggestions (owner_id TEXT NOT NULL, name TEXT NOT NULL, occurrences INTEGER NOT NULL CHECK(occurrences>0), last_seen_at TEXT NOT NULL, PRIMARY KEY(owner_id,name)) STRICT;
    CREATE TABLE content_enrichment_results (owner_id TEXT NOT NULL, article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('Succeeded','Failed')), summary TEXT, score INTEGER CHECK(score IS NULL OR (score>=0 AND score<=100)), reason TEXT, error TEXT, tokens_in INTEGER NOT NULL CHECK(tokens_in>=0), tokens_out INTEGER NOT NULL CHECK(tokens_out>=0), completed_at TEXT NOT NULL, PRIMARY KEY(owner_id,article_id)) STRICT;
    CREATE TABLE content_enrichment_queue (owner_id TEXT NOT NULL, article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE, priority INTEGER NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('New','Reprocess')), status TEXT NOT NULL CHECK(status IN ('Queued','Processing','Succeeded','Failed')), attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0), lease_token TEXT, lease_expires_at TEXT, published_at TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, error TEXT, PRIMARY KEY(owner_id,article_id)) STRICT;
    CREATE TABLE content_enrichment_daily_progress (local_date TEXT PRIMARY KEY, processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count>=0)) STRICT;
  `,
  production: `
    PRAGMA foreign_keys=ON;
    CREATE TABLE episode_jobs (job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(owner_id,idempotency_key)) STRICT;
    CREATE TABLE episode_execution_checkpoints (job_id TEXT PRIMARY KEY REFERENCES episode_jobs(job_id) ON DELETE CASCADE, script TEXT NOT NULL, audio TEXT) STRICT;
    CREATE TABLE episode_dictionary_snapshots (job_id TEXT PRIMARY KEY REFERENCES episode_jobs(job_id) ON DELETE CASCADE, snapshot TEXT NOT NULL) STRICT;
    CREATE TABLE episode_completion_outbox (job_id TEXT PRIMARY KEY REFERENCES episode_jobs(job_id) ON DELETE CASCADE, episode_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT) STRICT;
    CREATE TABLE episode_job_status_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES episode_jobs(job_id) ON DELETE CASCADE, owner_id TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE TRIGGER episode_job_status_events_insert AFTER INSERT ON episode_jobs BEGIN INSERT INTO episode_job_status_events(job_id,owner_id,document) VALUES(NEW.job_id,NEW.owner_id,NEW.document); END;
    CREATE TABLE reading_dictionary (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, surface TEXT NOT NULL, reading TEXT NOT NULL, accent_type INTEGER NOT NULL CHECK(accent_type BETWEEN 0 AND 100), source TEXT NOT NULL CHECK(source IN ('manual','ai_auto')), episode_job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id,surface)) STRICT;
    CREATE TABLE production_agent_instances (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, agent_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id,agent_key)) STRICT;
    CREATE TABLE production_agent_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES episode_jobs(job_id) ON DELETE CASCADE, owner_id TEXT NOT NULL, agent_instance_id TEXT REFERENCES production_agent_instances(id) ON DELETE SET NULL, model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','retrying','succeeded','failed','canceled')), policy_hash TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, failure_code TEXT) STRICT;
    CREATE TABLE production_agent_events (run_id TEXT NOT NULL REFERENCES production_agent_runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL CHECK(sequence>=0), event_type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), occurred_at TEXT NOT NULL, PRIMARY KEY(run_id,sequence)) STRICT;
    CREATE TABLE production_agent_memories (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, agent_instance_id TEXT NOT NULL REFERENCES production_agent_instances(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('preference','episode_history','working_note')), status TEXT NOT NULL CHECK(status IN ('proposed','active','rejected','deleted')), current_version INTEGER NOT NULL CHECK(current_version>=1), expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE production_agent_memory_versions (memory_id TEXT NOT NULL REFERENCES production_agent_memories(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version>=1), content_json TEXT NOT NULL CHECK(json_valid(content_json)), created_at TEXT NOT NULL, PRIMARY KEY(memory_id,version)) STRICT;
  `,
  library: `
    PRAGMA foreign_keys=ON;
    CREATE TABLE episode_completion_inbox (message_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, payload_hash TEXT NOT NULL, received_at TEXT NOT NULL) STRICT;
    CREATE TABLE episodes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL, audio_object_key TEXT NOT NULL, audio_byte_length INTEGER NOT NULL CHECK(audio_byte_length>0), audio_content_type TEXT NOT NULL CHECK(audio_content_type IN ('audio/wav','audio/mpeg')), created_at TEXT NOT NULL) STRICT;
    CREATE INDEX episodes_owner_created_idx ON episodes(owner_id,created_at DESC,id DESC);
    CREATE TABLE episode_sources (episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), source_kind TEXT NOT NULL CHECK(source_kind IN ('rss','web')), url TEXT NOT NULL, title TEXT NOT NULL, published_at TEXT, snapshot_id TEXT, PRIMARY KEY(episode_id,position), CHECK((source_kind='rss' AND snapshot_id IS NOT NULL) OR (source_kind='web' AND snapshot_id IS NULL AND published_at IS NULL))) STRICT;
  `,
})

const exists = (path) =>
  access(path).then(
    () => true,
    () => false
  )
const fail = (message) => {
  throw new Error(message)
}
const q = (database, sql, ...values) => database.prepare(sql).all(...values)
const scalar = (database, table) =>
  Number(database.prepare(`SELECT COUNT(*) count FROM "${table}"`).get().count)
const asString = (value, field) =>
  typeof value === "string" && value.length > 0
    ? value
    : fail(`invalid ${field}`)
const asJson = (value, field) => {
  try {
    return JSON.parse(asString(value, field))
  } catch {
    return fail(`invalid JSON in ${field}`)
  }
}
const terminalTime = (row) => row.finished_at ?? row.created_at
const clampAttempt = (value) => Math.max(1, Math.min(4, Number(value) || 1))
const isCanonicalInstant = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  new Date(value).toISOString() === value
const assertCanonicalInstant = (value, field) =>
  isCanonicalInstant(value) ? value : fail(`invalid UTC instant in ${field}`)
const assertHttpUrl = (value, field) => {
  try {
    if (!["http:", "https:"].includes(new URL(value).protocol))
      fail(`invalid HTTP URL in ${field}`)
    return value
  } catch {
    return fail(`invalid HTTP URL in ${field}`)
  }
}

const validateSource = (database) => {
  if (
    database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
  )
    fail("source integrity_check failed")
  const fk = database.prepare("PRAGMA foreign_key_check").all()
  if (fk.length > 0) fail("source foreign_key_check failed")
  const present = new Set(
    q(database, "SELECT name FROM sqlite_master WHERE type='table'").map(
      (row) => row.name
    )
  )
  const missing = requiredSourceTables.filter((table) => !present.has(table))
  if (missing.length > 0)
    fail(`unsupported legacy schema; missing tables: ${missing.join(", ")}`)
}

const insertRows = (target, sql, rows, values) => {
  const statement = target.prepare(sql)
  for (const row of rows) statement.run(...values(row))
}

const migrateIdentity = (source, target) => {
  for (const table of ["user", "session", "account", "verification"]) {
    const columns = q(source, `PRAGMA table_info("${table}")`)
      .map((row) => `"${row.name}"`)
      .join(",")
    const rows = q(source, `SELECT ${columns} FROM "${table}"`)
    if (rows.length > 0) {
      const placeholders = columns
        .split(",")
        .map(() => "?")
        .join(",")
      const keys = q(source, `PRAGMA table_info("${table}")`).map(
        (row) => row.name
      )
      insertRows(
        target,
        `INSERT INTO "${table}"(${columns}) VALUES(${placeholders})`,
        rows,
        (row) => keys.map((key) => row[key])
      )
    }
  }
  insertRows(
    target,
    "INSERT INTO user_settings VALUES(?,?,?,?,?)",
    q(
      source,
      "SELECT owner_id,schedule_enabled,schedule_local_time,schedule_time_zone,last_scheduled_local_date FROM user_settings"
    ),
    (r) => [
      r.owner_id,
      r.schedule_enabled,
      r.schedule_local_time,
      r.schedule_time_zone,
      r.last_scheduled_local_date,
    ]
  )
}

const legacySnapshot = (row, assets) => ({
  snapshotId: row.id,
  archiveRequestId: row.id,
  articleId: row.feed_item_id,
  sourceUrl: row.source_url,
  title: row.title,
  capturedAt: row.fetched_at,
  capture: {
    rawResponse: {
      _tag: "RawResponse",
      key: row.raw_key,
      sha256: row.content_hash,
      mediaType: "text/html",
      byteLength: row.byte_length,
    },
    replay: {
      _tag: "Replay",
      key: row.replay_key,
      sha256: row.content_hash,
      mediaType: "text/html",
      byteLength: row.byte_length,
    },
    markdown: {
      _tag: "Markdown",
      key: row.markdown_key,
      sha256: row.content_hash,
      mediaType: "text/markdown",
      byteLength: row.byte_length,
    },
    assets: assets.map((a) => ({
      _tag: "Asset",
      key: a.object_key,
      sha256: a.asset_hash,
      mediaType: a.content_type,
      byteLength: a.byte_length,
    })),
  },
})

const migrateContent = (source, target, migratedAt) => {
  insertRows(
    target,
    "INSERT INTO feed_catalog VALUES(?,?,?)",
    q(source, "SELECT id,feed_url,created_at FROM feed_catalog"),
    (r) => [r.id, r.feed_url, r.created_at]
  )
  insertRows(
    target,
    "INSERT INTO feed_subscriptions VALUES(?,?,?,?,?)",
    q(
      source,
      "SELECT id,owner_id,feed_id,created_at,enabled FROM feed_subscriptions"
    ),
    (r) => [r.id, r.owner_id, r.feed_id, r.created_at, r.enabled]
  )
  insertRows(
    target,
    "INSERT INTO feed_items VALUES(?,?,?,?,?,?,?)",
    q(
      source,
      "SELECT id,feed_id,external_id,url,title,published_at,discovered_at FROM feed_items"
    ),
    (r) => [
      r.id,
      r.feed_id,
      r.external_id,
      r.url,
      r.title,
      r.published_at,
      r.discovered_at,
    ]
  )
  insertRows(
    target,
    "INSERT INTO article_owner_states VALUES(?,?,?,?,?,?,?,?)",
    q(
      source,
      "SELECT owner_id,feed_item_id,read,saved,read_later,hidden,hidden_at,updated_at FROM article_user_states"
    ),
    (r) => [
      r.owner_id,
      r.feed_item_id,
      r.read,
      r.saved,
      r.read_later,
      r.hidden,
      r.hidden_at,
      r.updated_at,
    ]
  )
  const snapshots = q(
    source,
    "SELECT * FROM article_snapshots ORDER BY fetched_at,id"
  )
  insertRows(
    target,
    "INSERT INTO article_snapshots VALUES(?,?,?,?)",
    snapshots,
    (r) => {
      if (!/^[a-f\d]{64}$/.test(String(r.content_hash)))
        fail(`snapshot ${r.id} has an invalid SHA-256`)
      if (Number(r.byte_length) <= 0)
        fail(`snapshot ${r.id} has an invalid byte length`)
      if (new Set([r.raw_key, r.replay_key, r.markdown_key]).size !== 3)
        fail(`snapshot ${r.id} has duplicate object keys`)
      assertHttpUrl(r.source_url, `article_snapshots.${r.id}.source_url`)
      assertCanonicalInstant(
        r.fetched_at,
        `article_snapshots.${r.id}.fetched_at`
      )
      return [
        r.id,
        r.id,
        JSON.stringify(
          legacySnapshot(
            r,
            q(
              source,
              "SELECT * FROM archive_assets WHERE snapshot_id=? ORDER BY asset_hash",
              r.id
            )
          )
        ),
        r.fetched_at,
      ]
    }
  )
  insertRows(
    target,
    "INSERT INTO content_interest_profiles VALUES(?,?,?,?)",
    q(
      source,
      "SELECT owner_id,interest_include,interest_exclude FROM user_settings WHERE interest_include<>'' OR interest_exclude<>''"
    ),
    (r) => [r.owner_id, r.interest_include, r.interest_exclude, migratedAt]
  )
  insertRows(
    target,
    "INSERT INTO content_tags VALUES(?,?,?,?)",
    q(source, "SELECT id,owner_id,name,created_at FROM tags"),
    (r) => [r.id, r.owner_id, r.name, r.created_at]
  )
  insertRows(
    target,
    "INSERT INTO content_article_tags VALUES(?,?,?,?,?,?)",
    q(
      source,
      "SELECT owner_id,feed_item_id,tag_id,source,confidence,created_at FROM article_tags"
    ),
    (r) => [
      r.owner_id,
      r.feed_item_id,
      r.tag_id,
      r.source === "manual" ? "Manual" : "Ai",
      r.confidence,
      r.created_at,
    ]
  )
  insertRows(
    target,
    "INSERT INTO content_tag_suggestions VALUES(?,?,?,?)",
    q(
      source,
      "SELECT owner_id,name,occurrences,last_seen_at FROM tag_suggestions"
    ),
    (r) => [r.owner_id, r.name, r.occurrences, r.last_seen_at]
  )
  const relevance = q(source, "SELECT * FROM article_relevance")
  insertRows(
    target,
    "INSERT INTO content_enrichment_results VALUES(?,?,?,?,?,?,?,?,?,?)",
    relevance,
    (r) => {
      const summary = q(
        source,
        "SELECT summary_json,tokens_in,tokens_out FROM article_summaries WHERE snapshot_id=(SELECT latest_snapshot_id FROM feed_items WHERE id=?)",
        r.feed_item_id
      )[0]
      const parsed = summary
        ? asJson(summary.summary_json, "article_summaries.summary_json")
        : undefined
      return [
        r.owner_id,
        r.feed_item_id,
        r.status === "succeeded" ? "Succeeded" : "Failed",
        typeof parsed?.summary === "string" ? parsed.summary : null,
        r.score,
        r.reason,
        r.error,
        Number(r.tokens_in) + (summary ? Number(summary.tokens_in) : 0),
        Number(r.tokens_out) + (summary ? Number(summary.tokens_out) : 0),
        r.created_at,
      ]
    }
  )
  insertRows(
    target,
    "INSERT INTO content_enrichment_queue VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    q(source, "SELECT * FROM enrich_queue"),
    (r) => [
      r.owner_id,
      r.feed_item_id,
      r.priority,
      r.reason === "new" ? "New" : "Reprocess",
      {
        queued: "Queued",
        processing: "Processing",
        succeeded: "Succeeded",
        failed: "Failed",
      }[r.status] ?? fail("invalid enrich_queue.status"),
      r.attempt,
      r.lease_token,
      r.lease_expires_at,
      r.published_at,
      r.created_at,
      r.started_at,
      r.completed_at,
      r.error,
    ]
  )
  insertRows(
    target,
    "INSERT INTO content_enrichment_daily_progress VALUES(?,?)",
    q(
      source,
      "SELECT local_date,processed_count FROM ai_enrich_daily_progress"
    ),
    (r) => [r.local_date, r.processed_count]
  )
}

const requestForJob = (source, row) => {
  const articleIds = q(
    source,
    "SELECT feed_item_id FROM episode_job_articles WHERE job_id=? ORDER BY position",
    row.id
  ).map((v) => v.feed_item_id)
  const request = {
    ownerId: asString(row.owner_id, "episode_jobs.owner_id"),
    idempotencyKey: asString(
      row.idempotency_key,
      "episode_jobs.idempotency_key"
    ),
    trigger: "manual",
  }
  if (request.idempotencyKey.length > 128)
    fail("episode job idempotency key exceeds 128 characters")
  if (articleIds.length > 0) request.articleIds = articleIds
  return request
}
const jobDocument = (source, row) => {
  const request = requestForJob(source, row),
    attempt = clampAttempt(row.attempt),
    createdAt = row.created_at
  const base = {
    jobId: row.id,
    request,
    createdAt: assertCanonicalInstant(
      createdAt,
      `episode_jobs.${row.id}.created_at`
    ),
  }
  if (row.status === "succeeded") {
    if (!row.episode_id || !row.finished_at)
      fail(`succeeded job ${row.id} is incomplete`)
    return {
      ...base,
      _tag: "Succeeded",
      attempt,
      episodeId: row.episode_id,
      completedAt: row.finished_at,
    }
  }
  if (row.status === "failed")
    return {
      ...base,
      _tag: "Failed",
      attempt,
      failedAt: terminalTime(row),
      failure: { code: row.failure_code || "legacy-failure", retryable: false },
    }
  if (row.status === "canceled")
    return {
      ...base,
      _tag: "Canceled",
      attempt: Math.max(0, Number(row.attempt) || 0),
      canceledAt: terminalTime(row),
      reason: "requested_by_user",
    }
  return {
    ...base,
    _tag: "Failed",
    attempt,
    failedAt: row.created_at,
    failure: { code: "legacy-migration-requires-retry", retryable: false },
  }
}

const migrateProduction = (source, target) => {
  if (
    q(
      source,
      `SELECT run.id FROM agent_runs run JOIN episode_jobs job
         ON job.id=run.episode_job_id WHERE run.owner_id<>job.owner_id LIMIT 1`
    ).length > 0
  )
    fail("agent run owner does not match job owner")
  const jobs = q(source, "SELECT * FROM episode_jobs ORDER BY created_at,id")
  insertRows(
    target,
    "INSERT INTO episode_jobs(job_id,owner_id,idempotency_key,request_fingerprint,document) VALUES(?,?,?,?,?)",
    jobs,
    (r) => {
      const doc = jobDocument(source, r)
      return [
        r.id,
        r.owner_id,
        r.idempotency_key,
        JSON.stringify(doc.request),
        JSON.stringify(doc),
      ]
    }
  )
  insertRows(
    target,
    "INSERT INTO reading_dictionary VALUES(?,?,?,?,?,?,?,?,?)",
    q(
      source,
      "SELECT id,owner_id,surface,reading,accent_type,source,episode_job_id,created_at,updated_at FROM reading_dictionary"
    ),
    (r) => [
      r.id,
      r.owner_id,
      r.surface,
      r.reading,
      r.accent_type,
      r.source,
      r.episode_job_id,
      r.created_at,
      r.updated_at,
    ]
  )
  insertRows(
    target,
    "INSERT INTO production_agent_instances VALUES(?,?,?,?,?)",
    q(
      source,
      "SELECT id,owner_id,agent_key,created_at,updated_at FROM agent_instances"
    ),
    (r) => [r.id, r.owner_id, r.agent_key, r.created_at, r.updated_at]
  )
  insertRows(
    target,
    "INSERT INTO production_agent_runs VALUES(?,?,?,?,?,?,?,?,?,?)",
    q(
      source,
      "SELECT id,episode_job_id,owner_id,agent_instance_id,model,status,policy_hash,started_at,finished_at,failure_code FROM agent_runs"
    ),
    (r) => {
      const active = [
        "queued",
        "running",
        "waiting_approval",
        "retrying",
      ].includes(r.status)
      return [
        r.id,
        r.episode_job_id,
        r.owner_id,
        r.agent_instance_id,
        r.model,
        active ? "failed" : r.status,
        r.policy_hash,
        r.started_at,
        active ? r.started_at : r.finished_at,
        active ? "legacy-migration-requires-retry" : r.failure_code,
      ]
    }
  )
  const events = q(
    source,
    "SELECT agent_run_id,sequence,event_type,occurred_at FROM agent_events ORDER BY agent_run_id,sequence"
  )
  insertRows(
    target,
    "INSERT INTO production_agent_events VALUES(?,?,?,?,?)",
    events,
    (r) => [
      r.agent_run_id,
      r.sequence,
      "legacy.event",
      JSON.stringify({
        migratedFrom: "legacy-agent-event",
        originalType: String(r.event_type).slice(0, 80),
        payloadRedacted: true,
      }),
      r.occurred_at,
    ]
  )
  const nextSequences = new Map(
    q(
      target,
      "SELECT run_id,COALESCE(MAX(sequence),-1)+1 next_sequence FROM production_agent_events GROUP BY run_id"
    ).map((row) => [row.run_id, Number(row.next_sequence)])
  )
  const appendAudit = (runId, type, payload, occurredAt) => {
    const sequence = nextSequences.get(runId) ?? 0
    target
      .prepare("INSERT INTO production_agent_events VALUES(?,?,?,?,?)")
      .run(runId, sequence, type, JSON.stringify(payload), occurredAt)
    nextSequences.set(runId, sequence + 1)
  }
  for (const row of q(
    source,
    "SELECT agent_run_id,tool_name,effect,result_hash,created_at FROM agent_tool_calls ORDER BY agent_run_id,position,id"
  ))
    appendAudit(
      row.agent_run_id,
      "legacy.tool-call",
      {
        migratedFrom: "legacy-agent-tool-call",
        toolName: String(row.tool_name).slice(0, 100),
        effect: row.effect,
        resultHash: row.result_hash,
        payloadRedacted: true,
      },
      row.created_at
    )
  for (const row of q(
    source,
    "SELECT agent_run_id,tool_name,status,created_at FROM agent_approval_requests ORDER BY agent_run_id,created_at,id"
  ))
    appendAudit(
      row.agent_run_id,
      "legacy.approval",
      {
        migratedFrom: "legacy-agent-approval",
        toolName: String(row.tool_name).slice(0, 100),
        status: row.status,
        payloadRedacted: true,
      },
      row.created_at
    )
  insertRows(
    target,
    "INSERT INTO production_agent_memories VALUES(?,?,?,?,?,?,?,?,?)",
    q(
      source,
      "SELECT id,owner_id,agent_instance_id,kind,status,current_version,expires_at,created_at,updated_at FROM agent_memories"
    ),
    (r) => [
      r.id,
      r.owner_id,
      r.agent_instance_id,
      r.kind,
      r.status,
      r.current_version,
      r.expires_at,
      r.created_at,
      r.updated_at,
    ]
  )
  insertRows(
    target,
    "INSERT INTO production_agent_memory_versions VALUES(?,?,?,?)",
    q(
      source,
      "SELECT memory_id,version,content_json,created_at FROM agent_memory_versions"
    ),
    (r) => [
      r.memory_id,
      r.version,
      JSON.stringify(
        asJson(r.content_json, "agent_memory_versions.content_json")
      ),
      r.created_at,
    ]
  )
}

const migrateLibrary = (source, target) => {
  const episodes = q(source, "SELECT * FROM episodes ORDER BY created_at,id")
  insertRows(
    target,
    "INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?)",
    episodes,
    (r) => {
      if (!r.audio_key || Number(r.audio_byte_length) <= 0)
        fail(`episode ${r.id} has no durable audio`)
      return [
        r.id,
        r.owner_id,
        r.title,
        r.script,
        r.audio_key,
        r.audio_byte_length,
        "audio/wav",
        r.created_at,
      ]
    }
  )
  insertRows(
    target,
    "INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?)",
    q(source, "SELECT * FROM episode_sources ORDER BY episode_id,position"),
    (r) => {
      const kind = r.source_kind || "rss"
      if (kind === "rss" && !r.snapshot_id)
        fail(`RSS episode source ${r.episode_id}/${r.position} has no snapshot`)
      return [
        r.episode_id,
        r.position,
        kind,
        r.url,
        r.title,
        kind === "web" ? null : r.published_at,
        kind === "web" ? null : r.snapshot_id,
      ]
    }
  )
}

const validateTarget = (path, profile) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    if (
      database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    )
      fail(`${profile} integrity_check failed`)
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0)
      fail(`${profile} foreign_key_check failed`)
  } finally {
    database.close()
  }
}

const countManifest = (source) => ({
  source: Object.fromEntries(
    requiredSourceTables.map((t) => [t, scalar(source, t)])
  ),
  targets: {
    identity: {
      user: scalar(source, "user"),
      session: scalar(source, "session"),
      account: scalar(source, "account"),
      verification: scalar(source, "verification"),
      user_settings: scalar(source, "user_settings"),
    },
    content: {
      feed_catalog: scalar(source, "feed_catalog"),
      feed_subscriptions: scalar(source, "feed_subscriptions"),
      feed_items: scalar(source, "feed_items"),
      article_snapshots: scalar(source, "article_snapshots"),
      archive_assets: scalar(source, "archive_assets"),
      article_owner_states: scalar(source, "article_user_states"),
      content_tags: scalar(source, "tags"),
      content_article_tags: scalar(source, "article_tags"),
      content_enrichment_queue: scalar(source, "enrich_queue"),
    },
    production: {
      episode_jobs: scalar(source, "episode_jobs"),
      reading_dictionary: scalar(source, "reading_dictionary"),
      production_agent_instances: scalar(source, "agent_instances"),
      production_agent_runs: scalar(source, "agent_runs"),
      production_agent_events: scalar(source, "agent_events"),
      production_agent_memories: scalar(source, "agent_memories"),
    },
    library: {
      episodes: scalar(source, "episodes"),
      episode_sources: scalar(source, "episode_sources"),
    },
  },
  transformations: {
    activeJobs: "failed:legacy-migration-requires-retry",
    artifactHashes:
      "legacy content_hash reused for raw/replay/markdown metadata",
    feedCatalogMetadata:
      "legacy name/site URL/sync metadata retained only in rollback backup",
    agentAudit: {
      eventPayloads: "redacted",
      toolCallsConvertedToRedactedEvents: scalar(source, "agent_tool_calls"),
      approvalsConvertedToRedactedEvents: scalar(
        source,
        "agent_approval_requests"
      ),
    },
    executionArtifacts: {
      episode_job_drafts: scalar(source, "episode_job_drafts"),
      episode_audio_chunks: scalar(source, "episode_audio_chunks"),
    },
  },
})

export const migrateLegacyDatabase = async ({
  sourcePath,
  destinationDirectory,
  rollbackBackupPath,
  manifestPath,
  dryRun = false,
  now = () => new Date().toISOString(),
}) => {
  const source = resolve(sourcePath),
    destination = resolve(destinationDirectory)
  if (!(await exists(source))) fail("legacy source database does not exist")
  if (manifestPath && (await exists(resolve(manifestPath))))
    fail("migration manifest already exists")
  for (const profile of profiles)
    if (await exists(join(destination, targetNames[profile])))
      fail(`target already exists: ${targetNames[profile]}`)
  if (!dryRun && !rollbackBackupPath)
    fail("--backup is required for an executable migration")
  if (rollbackBackupPath && resolve(rollbackBackupPath) === source)
    fail("rollback backup must differ from the source database")
  if (rollbackBackupPath && (await exists(resolve(rollbackBackupPath))))
    fail("rollback backup already exists")
  const inspected = new DatabaseSync(source, { readOnly: true })
  try {
    validateSource(inspected)
    const manifest = {
      version: 1,
      dryRun,
      source,
      createdAt: now(),
      ...countManifest(inspected),
    }
    if (dryRun) {
      if (manifestPath) {
        await mkdir(dirname(resolve(manifestPath)), { recursive: true })
        await writeFile(
          resolve(manifestPath),
          `${JSON.stringify(manifest, null, 2)}\n`,
          { flag: "wx" }
        )
      }
      return manifest
    }
  } finally {
    inspected.close()
  }
  await mkdir(destination, { recursive: true })
  await mkdir(dirname(resolve(rollbackBackupPath)), { recursive: true })
  const live = new DatabaseSync(source, { readOnly: true })
  try {
    await backup(live, resolve(rollbackBackupPath))
  } finally {
    live.close()
  }
  const stable = new DatabaseSync(resolve(rollbackBackupPath), {
    readOnly: true,
  })
  const temporary = []
  try {
    validateSource(stable)
    const createdAt = now()
    const manifest = {
      version: 1,
      dryRun: false,
      source,
      rollbackBackup: resolve(rollbackBackupPath),
      createdAt,
      ...countManifest(stable),
    }
    for (const profile of profiles) {
      const path = join(destination, `.${targetNames[profile]}.migrating`)
      await rm(path, { force: true })
      temporary.push(path)
      const target = new DatabaseSync(path)
      try {
        target.exec(targetSchemas[profile])
        target.exec("BEGIN IMMEDIATE")
        ;({
          identity: migrateIdentity,
          content: (s, t) => migrateContent(s, t, createdAt),
          production: migrateProduction,
          library: migrateLibrary,
        })[profile](stable, target)
        target.exec("COMMIT")
      } catch (error) {
        try {
          target.exec("ROLLBACK")
        } catch {}
        throw error
      } finally {
        target.close()
      }
      validateTarget(path, profile)
    }
    for (let i = 0; i < profiles.length; i++)
      await rename(temporary[i], join(destination, targetNames[profiles[i]]))
    if (manifestPath) {
      await mkdir(dirname(resolve(manifestPath)), { recursive: true })
      await writeFile(
        resolve(manifestPath),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: "wx" }
      )
    }
    return manifest
  } finally {
    stable.close()
    await Promise.all(temporary.map((path) => rm(path, { force: true })))
  }
}

const parseArguments = (args) => {
  const result = { dryRun: false }
  for (let i = 0; i < args.length; i++) {
    const value = args[i]
    if (value === "--dry-run") {
      result.dryRun = true
      continue
    }
    const key = {
      "--source": "sourcePath",
      "--destination-dir": "destinationDirectory",
      "--backup": "rollbackBackupPath",
      "--manifest": "manifestPath",
    }[value]
    if (!key || !args[i + 1])
      fail(
        "usage: migrate-functional-ddd.mjs --source <legacy.sqlite> --destination-dir <dir> [--dry-run] [--backup <rollback.sqlite>] [--manifest <manifest.json>]"
      )
    result[key] = args[++i]
  }
  if (!result.sourcePath || !result.destinationDirectory)
    fail("--source and --destination-dir are required")
  return result
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  void migrateLegacyDatabase(parseArguments(process.argv.slice(2)))
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "migration failed")
      process.exitCode = 1
    })
}
