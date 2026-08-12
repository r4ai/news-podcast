import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { migrateLegacyDatabase } from "./migrate-functional-ddd.mjs"

const ids = Object.freeze({
  owner: "owner-1",
  feed: "10000000-0000-4000-8000-000000000001",
  subscription: "20000000-0000-4000-8000-000000000001",
  article: "30000000-0000-4000-8000-000000000001",
  snapshot: "40000000-0000-4000-8000-000000000001",
  job: "50000000-0000-4000-8000-000000000001",
  episode: "60000000-0000-4000-8000-000000000001",
  dictionary: "70000000-0000-4000-8000-000000000001",
  tag: "80000000-0000-4000-8000-000000000001",
  instance: "90000000-0000-4000-8000-000000000001",
  run: "a0000000-0000-4000-8000-000000000001",
  memory: "b0000000-0000-4000-8000-000000000001",
})
const now = "2026-08-13T00:00:00.000Z"

const createLegacyDatabase = (path, options = {}) => {
  const database = new DatabaseSync(path)
  const migrations = new URL(
    "../packages/adapters/migrations/",
    import.meta.url
  )
  const names = readdirSync(migrations).sort()
  for (const name of names) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"))
  }
  for (const name of names) {
    database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations(name,applied_at) VALUES(?,?)"
      )
      .run(name, now)
  }
  database
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)"
    )
    .run(ids.owner, "Owner", "owner@example.com", 1, 1, 1)
  database
    .prepare(
      "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)"
    )
    .run("session-1", 9999999999999, "token-1", 1, 1, ids.owner)
  database
    .prepare(
      "INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)"
    )
    .run("account-1", "owner@example.com", "credential", ids.owner, 1, 1)
  database
    .prepare(
      "INSERT INTO verification(id,identifier,value,expiresAt) VALUES(?,?,?,?)"
    )
    .run("verification-1", "owner@example.com", "value", 9999999999999)
  database
    .prepare(
      "INSERT INTO user_settings(owner_id,schedule_enabled,schedule_local_time,schedule_time_zone,interest_include,interest_exclude) VALUES(?,?,?,?,?,?)"
    )
    .run(ids.owner, 1, "07:30", "Asia/Tokyo", "TypeScript", "sports")
  database
    .prepare(
      "INSERT INTO feed_catalog(id,name,site_url,feed_url,created_at) VALUES(?,?,?,?,?)"
    )
    .run(
      ids.feed,
      "Example",
      "https://example.com/",
      "https://example.com/feed.xml",
      now
    )
  database
    .prepare(
      "INSERT INTO feed_subscriptions(id,owner_id,feed_id,enabled,created_at) VALUES(?,?,?,?,?)"
    )
    .run(ids.subscription, ids.owner, ids.feed, 1, now)
  database
    .prepare(
      "INSERT INTO feed_items(id,feed_id,external_id,title,url,published_at,discovered_at,archive_status,latest_snapshot_id) VALUES(?,?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.article,
      ids.feed,
      "external-1",
      "Article",
      "https://example.com/article",
      now,
      now,
      "succeeded",
      ids.snapshot
    )
  database
    .prepare(
      "INSERT INTO article_snapshots(id,feed_item_id,source_url,title,fetched_at,content_hash,raw_key,replay_key,markdown_key,byte_length) VALUES(?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.snapshot,
      ids.article,
      "https://example.com/article",
      "Article",
      now,
      "1".repeat(64),
      "articles/raw.html",
      "articles/replay.html",
      "articles/article.md",
      100
    )
  database
    .prepare(
      "INSERT INTO article_user_states(owner_id,feed_item_id,read,saved,read_later,hidden,updated_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(ids.owner, ids.article, 1, 1, 1, 0, now)
  database
    .prepare("INSERT INTO tags(id,owner_id,name,created_at) VALUES(?,?,?,?)")
    .run(ids.tag, ids.owner, "TypeScript", now)
  database
    .prepare(
      "INSERT INTO article_tags(owner_id,feed_item_id,tag_id,source,confidence,created_at) VALUES(?,?,?,?,?,?)"
    )
    .run(ids.owner, ids.article, ids.tag, "manual", null, now)
  database
    .prepare(
      "INSERT INTO article_summaries(snapshot_id,model,prompt_version,summary_json,tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      ids.snapshot,
      "model",
      "v1",
      JSON.stringify({ summary: "要約" }),
      10,
      5,
      now
    )
  database
    .prepare(
      "INSERT INTO article_relevance(owner_id,feed_item_id,profile_hash,model,prompt_version,score,reason,status,tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.owner,
      ids.article,
      "hash",
      "model",
      "v1",
      90,
      "match",
      "succeeded",
      20,
      5,
      now
    )
  database
    .prepare(
      "INSERT INTO enrich_queue(owner_id,feed_item_id,priority,reason,status,created_at) VALUES(?,?,?,?,?,?)"
    )
    .run(ids.owner, ids.article, 0, "new", "succeeded", now)
  database
    .prepare(
      "INSERT INTO ai_enrich_daily_progress(local_date,processed_count) VALUES(?,?)"
    )
    .run("2026-08-13", 1)
  database
    .prepare(
      "INSERT INTO episode_jobs(id,owner_id,idempotency_route,idempotency_key,request_hash,status,receipt_json,available_at,created_at,attempt) VALUES(?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.job,
      ids.owner,
      "POST:/v1/episode-jobs",
      "key-1",
      "hash",
      "queued",
      JSON.stringify({ id: ids.job, status: "queued", createdAt: now }),
      now,
      now,
      0
    )
  database
    .prepare(
      "INSERT INTO episode_job_articles(job_id,feed_item_id,position) VALUES(?,?,?)"
    )
    .run(ids.job, ids.article, 0)
  database
    .prepare(
      "INSERT INTO reading_dictionary(id,owner_id,surface,reading,accent_type,source,episode_job_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.dictionary,
      ids.owner,
      "Codex",
      "コーデックス",
      0,
      "manual",
      ids.job,
      now,
      now
    )
  database
    .prepare(
      "INSERT INTO agent_instances(id,owner_id,agent_key,created_at,updated_at) VALUES(?,?,?,?,?)"
    )
    .run(ids.instance, ids.owner, "podcast", now, now)
  database
    .prepare(
      "INSERT INTO agent_runs(id,episode_job_id,owner_id,agent_instance_id,model,status,policy_hash,started_at) VALUES(?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.run,
      ids.job,
      ids.owner,
      ids.instance,
      "model",
      "running",
      "policy",
      now
    )
  database
    .prepare(
      "INSERT INTO agent_events(id,agent_run_id,sequence,event_type,payload_json,occurred_at) VALUES(?,?,?,?,?,?)"
    )
    .run(
      "event-1",
      ids.run,
      0,
      "tool.completed",
      JSON.stringify({ reasoning: "must-not-migrate" }),
      now
    )
  database
    .prepare(
      "INSERT INTO agent_tool_calls(id,agent_run_id,position,tool_call_id,tool_name,effect,input_json,output_summary_json,result_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      "tool-event-1",
      ids.run,
      0,
      "call-1",
      "search_articles",
      "read",
      JSON.stringify({ secret: "must-not-migrate" }),
      JSON.stringify({ result: "must-not-migrate" }),
      "2".repeat(64),
      now
    )
  database
    .prepare(
      "INSERT INTO agent_approval_requests(id,agent_run_id,owner_id,tool_call_id,tool_name,arguments_json,arguments_hash,policy_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      "approval-1",
      ids.run,
      ids.owner,
      "call-2",
      "write_object",
      JSON.stringify({ secret: "must-not-migrate" }),
      "3".repeat(64),
      "policy",
      "denied",
      now,
      now
    )
  database
    .prepare(
      "INSERT INTO agent_memories(id,owner_id,agent_instance_id,kind,status,current_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
    )
    .run(
      ids.memory,
      ids.owner,
      ids.instance,
      "preference",
      "active",
      1,
      now,
      now
    )
  database
    .prepare(
      "INSERT INTO agent_memory_versions(memory_id,version,content_json,created_at) VALUES(?,?,?,?)"
    )
    .run(ids.memory, 1, JSON.stringify({ topic: "TypeScript" }), now)
  database
    .prepare(
      "INSERT INTO episodes(id,owner_id,title,script,audio_key,audio_byte_length,created_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      ids.episode,
      ids.owner,
      "Episode",
      "Script",
      options.missingAudio ? null : "audio/episode.wav",
      options.missingAudio ? null : 123,
      now
    )
  database
    .prepare(
      "INSERT INTO episode_sources(episode_id,position,url,title,published_at,snapshot_id,source_kind) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      ids.episode,
      0,
      "https://example.com/article",
      "Article",
      now,
      ids.snapshot,
      "rss"
    )
  database.close()
}

test("dry-run validates the whole legacy schema without creating state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "functional-ddd-migration-"))
  try {
    const source = join(directory, "legacy.sqlite"),
      destination = join(directory, "services"),
      manifestPath = join(directory, "dry-run.json")
    createLegacyDatabase(source)
    const manifest = await migrateLegacyDatabase({
      sourcePath: source,
      destinationDirectory: destination,
      manifestPath,
      dryRun: true,
      now: () => now,
    })
    assert.equal(manifest.targets.production.episode_jobs, 1)
    assert.equal(manifest.targets.content.article_snapshots, 1)
    assert.equal(
      manifest.transformations.executionArtifacts.episode_audio_chunks,
      0
    )
    await assert.rejects(accessFile(join(destination, "identity.sqlite")))
    assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).dryRun, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("migrates owner-scoped business state into four healthy service databases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "functional-ddd-migration-"))
  try {
    const source = join(directory, "legacy.sqlite"),
      destination = join(directory, "services"),
      backupPath = join(directory, "rollback.sqlite"),
      manifestPath = join(directory, "manifest.json")
    createLegacyDatabase(source)
    await migrateLegacyDatabase({
      sourcePath: source,
      destinationDirectory: destination,
      rollbackBackupPath: backupPath,
      manifestPath,
      now: () => now,
    })
    const identity = new DatabaseSync(join(destination, "identity.sqlite"), {
      readOnly: true,
    })
    assert.deepEqual(
      {
        ...identity
          .prepare("SELECT owner_id,schedule_enabled FROM user_settings")
          .get(),
      },
      { owner_id: ids.owner, schedule_enabled: 1 }
    )
    identity.close()
    const content = new DatabaseSync(join(destination, "content.sqlite"), {
      readOnly: true,
    })
    assert.equal(
      content
        .prepare(
          "SELECT json_extract(snapshot_json,'$.articleId') article FROM article_snapshots"
        )
        .get().article,
      ids.article
    )
    assert.deepEqual(
      {
        ...content
          .prepare(
            "SELECT summary,score,tokens_in FROM content_enrichment_results"
          )
          .get(),
      },
      { summary: "要約", score: 90, tokens_in: 30 }
    )
    content.close()
    const production = new DatabaseSync(
      join(destination, "production.sqlite"),
      { readOnly: true }
    )
    const document = JSON.parse(
      production.prepare("SELECT document FROM episode_jobs").get().document
    )
    assert.equal(document._tag, "Failed")
    assert.equal(document.failure.code, "legacy-migration-requires-retry")
    assert.deepEqual(document.request.articleIds, [ids.article])
    const event = JSON.parse(
      production
        .prepare("SELECT payload_json FROM production_agent_events")
        .get().payload_json
    )
    assert.equal(event.payloadRedacted, true)
    assert.equal(JSON.stringify(event).includes("reasoning"), false)
    assert.deepEqual(
      {
        ...production
          .prepare("SELECT status,failure_code FROM production_agent_runs")
          .get(),
      },
      {
        status: "failed",
        failure_code: "legacy-migration-requires-retry",
      }
    )
    assert.equal(
      production
        .prepare("SELECT COUNT(*) count FROM production_agent_events")
        .get().count,
      3
    )
    assert.equal(
      production
        .prepare(
          "SELECT group_concat(payload_json) payload FROM production_agent_events"
        )
        .get()
        .payload.includes("must-not-migrate"),
      false
    )
    production.close()
    const library = new DatabaseSync(join(destination, "library.sqlite"), {
      readOnly: true,
    })
    assert.deepEqual(
      {
        ...library
          .prepare("SELECT owner_id,audio_object_key FROM episodes")
          .get(),
      },
      { owner_id: ids.owner, audio_object_key: "audio/episode.wav" }
    )
    library.close()
    assert.equal(
      new DatabaseSync(backupPath, { readOnly: true })
        .prepare("PRAGMA integrity_check")
        .get().integrity_check,
      "ok"
    )
    assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).dryRun, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("fails closed and publishes no partial service databases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "functional-ddd-migration-"))
  try {
    const source = join(directory, "legacy.sqlite"),
      destination = join(directory, "services"),
      backupPath = join(directory, "rollback.sqlite")
    createLegacyDatabase(source, { missingAudio: true })
    await assert.rejects(
      migrateLegacyDatabase({
        sourcePath: source,
        destinationDirectory: destination,
        rollbackBackupPath: backupPath,
        now: () => now,
      }),
      /has no durable audio/
    )
    for (const name of [
      "identity.sqlite",
      "content.sqlite",
      "production.sqlite",
      "library.sqlite",
    ])
      await assert.rejects(accessFile(join(destination, name)))
    assert.equal(
      new DatabaseSync(backupPath, { readOnly: true })
        .prepare("PRAGMA integrity_check")
        .get().integrity_check,
      "ok"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses an unsupported source and every existing target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "functional-ddd-migration-"))
  try {
    const source = join(directory, "legacy.sqlite"),
      destination = join(directory, "services")
    const unsupported = new DatabaseSync(source)
    unsupported.exec("CREATE TABLE episode_jobs(id TEXT PRIMARY KEY)")
    unsupported.close()
    await assert.rejects(
      migrateLegacyDatabase({
        sourcePath: source,
        destinationDirectory: destination,
        dryRun: true,
      }),
      /unsupported legacy schema/
    )
    createLegacyDatabase(join(directory, "valid.sqlite"))
    await writeFile(join(directory, "identity.sqlite"), "")
    await assert.rejects(
      migrateLegacyDatabase({
        sourcePath: join(directory, "valid.sqlite"),
        destinationDirectory: directory,
        rollbackBackupPath: join(directory, "backup.sqlite"),
      }),
      /target already exists: identity.sqlite/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const accessFile = async (path) =>
  import("node:fs/promises").then(({ access }) => access(path))
