import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import type {
  EpisodeJobRecord,
  EpisodeJobRepository,
  EpisodeTraceContext,
  GenerationSchedule,
} from "@news-podcast/application"
import type { JobStatus } from "@news-podcast/domain"

export type JobStage =
  | "researching_sources"
  | "fetching_sources"
  | "generating_script"
  | "synthesizing_audio"
  | "storing_episode"

export interface FeedDto {
  readonly id: string
  readonly name: string
  readonly siteUrl: string
  readonly feedUrl: string
}

export interface FeedItemInput {
  readonly externalId: string
  readonly title: string
  readonly url: string
  readonly publishedAt?: string
  readonly summary?: string
}

export interface ArchiveCandidate {
  readonly id: string
  readonly feedId: string
  readonly sourceName: string
  readonly title: string
  readonly url: string
  readonly publishedAt?: string
}

export interface ArticleDto {
  readonly id: string
  readonly feedId: string
  readonly sourceName: string
  readonly title: string
  readonly url: string
  readonly publishedAt?: string
  readonly summary?: string
  readonly discoveredAt: string
  readonly archiveStatus: "pending" | "archiving" | "succeeded" | "failed"
  readonly snapshotId?: string
  readonly read: boolean
  readonly saved: boolean
}

export interface SubscriptionDto {
  readonly id: string
  readonly feedId: string
  readonly enabled: boolean
  readonly createdAt: string
}

export interface JobFailureDto {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

export interface JobDto {
  readonly id: string
  readonly status: JobStatus
  readonly createdAt: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly stage?: JobStage
  readonly stageStartedAt?: string
  readonly lastProgressAt?: string
  readonly deadlineAt?: string
  readonly stageProgress?: {
    readonly completed: number
    readonly total: number
  }
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly nextAttemptAt?: string
  readonly episodeId?: string
  readonly failure?: JobFailureDto
}

export interface JobReconciliationResult {
  readonly deadlineExceeded: number
  readonly attemptLimitExceeded: number
}

export interface JobHealthSnapshot {
  readonly jobs: Readonly<Record<"queued" | "running" | "retrying", number>>
  readonly oldestQueueAgeMs: number
  readonly oldestStageAgeMs: Readonly<Partial<Record<JobStage, number>>>
  readonly expiredLeases: number
  readonly cleanupBacklog: number
  readonly stagingBytes: number
}

export interface EpisodeSourceDto {
  readonly url: string
  readonly title: string
  readonly publishedAt?: string
  readonly snapshotId?: string
  readonly sourceKind?: "rss" | "web"
}

export interface EpisodeDto {
  readonly id: string
  readonly title: string
  readonly script: string
  readonly sources: readonly EpisodeSourceDto[]
  readonly createdAt: string
}

export interface WorkerJob {
  readonly id: string
  readonly ownerId: string
  readonly attempt: number
  readonly leaseToken: string
  readonly leaseExpiresAt: Date
  readonly deadlineAt: Date
  readonly recovered: boolean
  readonly generationPolicyHash: string
  readonly traceContext?: EpisodeTraceContext
}

export interface DraftCheckpoint {
  readonly inputHash: string
  readonly title: string
  readonly script: string
  readonly sourceUrls: readonly URL[]
}

export interface AudioChunkCheckpoint {
  readonly position: number
  readonly objectKey: string
  readonly contentHash: string
  readonly byteLength: number
}

export interface ObjectCleanupCandidate {
  readonly objectKey: string
  readonly attempt: number
}

export class LeaseLostError extends Error {
  constructor(readonly jobId: string) {
    super(`Episode job lease was lost: ${jobId}`)
    this.name = "LeaseLostError"
  }
}

export interface ScheduledOwner {
  readonly ownerId: string
  readonly schedule: GenerationSchedule
  readonly lastScheduledLocalDate?: string
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different request")
    this.name = "IdempotencyConflictError"
  }
}

export class LocalStore implements EpisodeJobRepository {
  readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec("PRAGMA foreign_keys = ON")
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.applyMigrations()
  }

  close(): void {
    this.database.close()
  }

  listFeeds(query?: string): readonly FeedDto[] {
    const rows = query
      ? this.database
          .prepare(
            `SELECT id, name, site_url, feed_url FROM feed_catalog
             WHERE name LIKE ? ORDER BY name`
          )
          .all(`%${query}%`)
      : this.database
          .prepare(
            "SELECT id, name, site_url, feed_url FROM feed_catalog ORDER BY name"
          )
          .all()
    return rows.map(toFeed)
  }

  listVisibleFeeds(ownerId: string, query?: string): readonly FeedDto[] {
    const pattern = `%${query ?? ""}%`
    return this.database
      .prepare(
        `SELECT DISTINCT f.id, f.name, f.site_url, f.feed_url
         FROM feed_catalog f
         LEFT JOIN feed_subscriptions s
           ON s.feed_id = f.id AND s.owner_id = ?
         WHERE (f.created_by_owner_id IS NULL OR s.id IS NOT NULL)
           AND f.name LIKE ?
         ORDER BY f.name`
      )
      .all(ownerId, pattern)
      .map(toFeed)
  }

  registerFeed(input: {
    readonly ownerId: string
    readonly name: string
    readonly siteUrl: string
    readonly feedUrl: string
  }): { readonly feed: FeedDto; readonly subscription: SubscriptionDto } {
    return this.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT id, name, site_url, feed_url FROM feed_catalog WHERE feed_url = ?"
        )
        .get(input.feedUrl)
      const feed = existing
        ? toFeed(existing)
        : {
            id: randomUUID(),
            name: input.name,
            siteUrl: input.siteUrl,
            feedUrl: input.feedUrl,
          }
      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO feed_catalog
             (id, name, site_url, feed_url, created_at, created_by_owner_id, next_sync_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            feed.id,
            feed.name,
            feed.siteUrl,
            feed.feedUrl,
            new Date().toISOString(),
            input.ownerId,
            new Date(0).toISOString()
          )
      }
      const existingSubscription = this.database
        .prepare(
          `SELECT id, feed_id, enabled, created_at FROM feed_subscriptions
           WHERE owner_id = ? AND feed_id = ?`
        )
        .get(input.ownerId, feed.id)
      if (existingSubscription) {
        return { feed, subscription: toSubscription(existingSubscription) }
      }
      const subscription: SubscriptionDto = {
        id: randomUUID(),
        feedId: feed.id,
        enabled: true,
        createdAt: new Date().toISOString(),
      }
      this.database
        .prepare(
          `INSERT INTO feed_subscriptions
           (id, owner_id, feed_id, enabled, created_at) VALUES (?, ?, ?, 1, ?)`
        )
        .run(
          subscription.id,
          input.ownerId,
          subscription.feedId,
          subscription.createdAt
        )
      return { feed, subscription }
    })
  }

  listFeedsDue(now = new Date(), limit = 5): readonly FeedDto[] {
    return this.database
      .prepare(
        `SELECT DISTINCT f.id, f.name, f.site_url, f.feed_url
         FROM feed_catalog f
         JOIN feed_subscriptions s ON s.feed_id = f.id AND s.enabled = 1
         WHERE f.next_sync_at IS NULL OR f.next_sync_at <= ?
         ORDER BY COALESCE(f.next_sync_at, ''), f.id LIMIT ?`
      )
      .all(now.toISOString(), limit)
      .map(toFeed)
  }

  upsertFeedItems(feedId: string, items: readonly FeedItemInput[]): number {
    const insert = this.database.prepare(
      `INSERT INTO feed_items
       (id, feed_id, external_id, title, url, published_at, summary, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feed_id, external_id) DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         published_at = excluded.published_at,
         summary = excluded.summary`
    )
    let created = 0
    this.transaction(() => {
      for (const item of items) {
        const before = this.database
          .prepare(
            "SELECT 1 FROM feed_items WHERE feed_id = ? AND external_id = ?"
          )
          .get(feedId, item.externalId)
        insert.run(
          randomUUID(),
          feedId,
          item.externalId,
          item.title,
          item.url,
          item.publishedAt ?? null,
          item.summary ?? null,
          new Date().toISOString()
        )
        if (!before) created += 1
      }
    })
    return created
  }

  markFeedSynced(feedId: string, error?: string): void {
    const now = new Date()
    this.database
      .prepare(
        `UPDATE feed_catalog SET last_synced_at = ?, next_sync_at = ?, sync_error = ?
         WHERE id = ?`
      )
      .run(
        now.toISOString(),
        new Date(now.getTime() + (error ? 5 : 30) * 60_000).toISOString(),
        error ?? null,
        feedId
      )
  }

  leaseArchiveCandidate(): ArchiveCandidate | undefined {
    return this.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT i.id, i.feed_id, i.title, i.url, i.published_at,
                  f.name AS source_name
           FROM feed_items i JOIN feed_catalog f ON f.id = i.feed_id
           WHERE i.archive_status = 'pending'
              OR (i.archive_status = 'failed' AND i.next_archive_at <= ?)
           ORDER BY i.discovered_at, i.id LIMIT 1`
        )
        .get(new Date().toISOString()) as Record<string, unknown> | undefined
      if (!row) return undefined
      this.database
        .prepare(
          `UPDATE feed_items SET archive_status = 'archiving', archive_error = NULL,
           archive_attempt = archive_attempt + 1, next_archive_at = NULL WHERE id = ?`
        )
        .run(String(row.id))
      return {
        id: String(row.id),
        feedId: String(row.feed_id),
        sourceName: String(row.source_name),
        title: String(row.title),
        url: String(row.url),
        ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
      }
    })
  }

  completeArchive(input: {
    readonly articleId: string
    readonly snapshotId: string
    readonly sourceUrl: string
    readonly title: string
    readonly contentHash: string
    readonly rawKey: string
    readonly replayKey: string
    readonly markdownKey: string
    readonly byteLength: number
    readonly assets: readonly {
      hash: string
      originalUrl: string
      key: string
      contentType: string
      byteLength: number
    }[]
  }): void {
    this.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT id FROM article_snapshots
           WHERE feed_item_id = ? AND content_hash = ?`
        )
        .get(input.articleId, input.contentHash) as
        | Record<string, unknown>
        | undefined
      const snapshotId = existing ? String(existing.id) : input.snapshotId
      if (existing) {
        this.database
          .prepare(
            `UPDATE article_snapshots SET source_url = ?, title = ?, fetched_at = ?,
             raw_key = ?, replay_key = ?, markdown_key = ?, byte_length = ?
             WHERE id = ?`
          )
          .run(
            input.sourceUrl,
            input.title,
            new Date().toISOString(),
            input.rawKey,
            input.replayKey,
            input.markdownKey,
            input.byteLength,
            snapshotId
          )
        this.database
          .prepare("DELETE FROM archive_assets WHERE snapshot_id = ?")
          .run(snapshotId)
      } else {
        this.database
          .prepare(
            `INSERT INTO article_snapshots
           (id, feed_item_id, source_url, title, fetched_at, content_hash,
            raw_key, replay_key, markdown_key, byte_length)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            snapshotId,
            input.articleId,
            input.sourceUrl,
            input.title,
            new Date().toISOString(),
            input.contentHash,
            input.rawKey,
            input.replayKey,
            input.markdownKey,
            input.byteLength
          )
      }
      const insertAsset = this.database.prepare(
        `INSERT OR REPLACE INTO archive_assets
         (snapshot_id, asset_hash, original_url, object_key, content_type, byte_length)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      input.assets.forEach((asset) =>
        insertAsset.run(
          snapshotId,
          asset.hash,
          asset.originalUrl,
          asset.key,
          asset.contentType,
          asset.byteLength
        )
      )
      this.database
        .prepare(
          `UPDATE feed_items SET archive_status = 'succeeded', archive_error = NULL,
           latest_snapshot_id = ? WHERE id = ?`
        )
        .run(snapshotId, input.articleId)
    })
  }

  failArchive(articleId: string, message: string): void {
    this.database
      .prepare(
        `UPDATE feed_items SET archive_status = 'failed', archive_error = ?,
         next_archive_at = ? WHERE id = ?`
      )
      .run(
        message.slice(0, 500),
        new Date(Date.now() + 30 * 60_000).toISOString(),
        articleId
      )
  }

  listArticles(ownerId: string, limit = 100): readonly ArticleDto[] {
    return this.articleRows(ownerId, undefined, limit).map(toArticle)
  }

  getArticle(ownerId: string, articleId: string): ArticleDto | undefined {
    const row = this.articleRows(ownerId, articleId, 1)[0]
    return row ? toArticle(row) : undefined
  }

  setArticleState(
    ownerId: string,
    articleId: string,
    state: { readonly read?: boolean; readonly saved?: boolean }
  ): ArticleDto | undefined {
    if (!this.getArticle(ownerId, articleId)) return undefined
    const current = this.database
      .prepare(
        "SELECT read, saved FROM article_user_states WHERE owner_id = ? AND feed_item_id = ?"
      )
      .get(ownerId, articleId) as Record<string, unknown> | undefined
    this.database
      .prepare(
        `INSERT INTO article_user_states (owner_id, feed_item_id, read, saved, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, feed_item_id) DO UPDATE SET
           read = excluded.read, saved = excluded.saved, updated_at = excluded.updated_at`
      )
      .run(
        ownerId,
        articleId,
        (state.read ?? Boolean(current?.read)) ? 1 : 0,
        (state.saved ?? Boolean(current?.saved)) ? 1 : 0,
        new Date().toISOString()
      )
    return this.getArticle(ownerId, articleId)
  }

  getArticleObject(
    ownerId: string,
    articleId: string,
    kind: "markdown" | "replay" | "raw"
  ): { readonly key: string; readonly snapshotId: string } | undefined {
    const article = this.getArticle(ownerId, articleId)
    if (!article?.snapshotId) return undefined
    const column =
      kind === "markdown"
        ? "markdown_key"
        : kind === "replay"
          ? "replay_key"
          : "raw_key"
    const row = this.database
      .prepare(
        `SELECT ${column} AS object_key FROM article_snapshots WHERE id = ?`
      )
      .get(article.snapshotId) as Record<string, unknown> | undefined
    return row
      ? { key: String(row.object_key), snapshotId: article.snapshotId }
      : undefined
  }

  getArticleAsset(
    ownerId: string,
    articleId: string,
    hash: string
  ): { readonly key: string; readonly contentType: string } | undefined {
    const article = this.getArticle(ownerId, articleId)
    if (!article?.snapshotId) return undefined
    const row = this.database
      .prepare(
        `SELECT object_key, content_type FROM archive_assets
         WHERE snapshot_id = ? AND asset_hash = ?`
      )
      .get(article.snapshotId, hash) as Record<string, unknown> | undefined
    return row
      ? { key: String(row.object_key), contentType: String(row.content_type) }
      : undefined
  }

  resolveEpisodeSources(
    ownerId: string,
    urls: readonly URL[]
  ): readonly EpisodeSourceDto[] {
    return urls.map((url) => {
      const row = this.database
        .prepare(
          `SELECT i.title, i.published_at, i.latest_snapshot_id
           FROM feed_items i
           JOIN feed_subscriptions s ON s.feed_id = i.feed_id
           WHERE s.owner_id = ? AND i.url = ? LIMIT 1`
        )
        .get(ownerId, url.href) as Record<string, unknown> | undefined
      if (!row) {
        return { url: url.href, title: url.hostname, sourceKind: "web" }
      }
      return {
        url: url.href,
        title: String(row.title),
        ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
        ...(row.latest_snapshot_id
          ? { snapshotId: String(row.latest_snapshot_id) }
          : {}),
        sourceKind: "rss",
      }
    })
  }

  listAgentArticles(
    ownerId: string,
    feedIds: readonly string[],
    limit: number
  ): readonly ArticleDto[] {
    if (feedIds.length === 0) return []
    const placeholders = feedIds.map(() => "?").join(",")
    return this.database
      .prepare(
        `SELECT i.id, i.feed_id, f.name AS source_name, i.title, i.url,
                i.published_at, i.summary, i.discovered_at, i.archive_status,
                i.latest_snapshot_id, 0 AS read, 0 AS saved
         FROM feed_items i
         JOIN feed_catalog f ON f.id = i.feed_id
         JOIN feed_subscriptions s
           ON s.feed_id = i.feed_id AND s.owner_id = ? AND s.enabled = 1
         WHERE i.archive_status = 'succeeded'
           AND i.latest_snapshot_id IS NOT NULL
           AND i.feed_id IN (${placeholders})
         ORDER BY COALESCE(i.published_at, i.discovered_at) DESC
         LIMIT ?`
      )
      .all(ownerId, ...feedIds, limit)
      .map(toArticle)
  }

  startAgentRun(input: {
    readonly jobId: string
    readonly ownerId: string
    readonly model: string
  }): string {
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO agent_runs
         (id, episode_job_id, owner_id, model, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`
      )
      .run(
        id,
        input.jobId,
        input.ownerId,
        input.model,
        new Date().toISOString()
      )
    return id
  }

  recordAgentToolCall(input: {
    readonly runId: string
    readonly position: number
    readonly name: string
    readonly argumentsJson: string
    readonly outputSummary: unknown
  }): void {
    this.database
      .prepare(
        `INSERT INTO agent_tool_calls
         (id, agent_run_id, position, tool_name, input_json,
          output_summary_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.runId,
        input.position,
        input.name,
        input.argumentsJson.slice(0, 10_000),
        JSON.stringify(input.outputSummary).slice(0, 10_000),
        new Date().toISOString()
      )
    this.database
      .prepare(
        "UPDATE agent_runs SET tool_call_count = ?, turn_count = MAX(turn_count, ?) WHERE id = ?"
      )
      .run(input.position + 1, input.position + 1, input.runId)
  }

  finishAgentRun(runId: string, failureCode?: string): void {
    this.database
      .prepare(
        `UPDATE agent_runs SET status = ?, finished_at = ?, failure_code = ?
         WHERE id = ?`
      )
      .run(
        failureCode ? "failed" : "succeeded",
        new Date().toISOString(),
        failureCode ?? null,
        runId
      )
  }

  listSubscriptions(ownerId: string): readonly SubscriptionDto[] {
    return this.database
      .prepare(
        `SELECT id, feed_id, enabled, created_at FROM feed_subscriptions
         WHERE owner_id = ? ORDER BY created_at, id`
      )
      .all(ownerId)
      .map(toSubscription)
  }

  ensureDefaultSubscriptions(ownerId: string): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO feed_subscriptions
       (id, owner_id, feed_id, enabled, created_at)
       VALUES (?, ?, ?, 1, ?)`
    )
    const defaultFeeds = this.database
      .prepare(
        `SELECT id, name, site_url, feed_url FROM feed_catalog
         WHERE created_by_owner_id IS NULL ORDER BY name`
      )
      .all()
      .map(toFeed)
    for (const feed of defaultFeeds) {
      insert.run(randomUUID(), ownerId, feed.id, new Date().toISOString())
    }
  }

  createSubscription(ownerId: string, feedId: string): SubscriptionDto {
    const feed = this.database
      .prepare("SELECT id FROM feed_catalog WHERE id = ?")
      .get(feedId)
    if (!feed) throw new Error("feed-not-found")
    const value = {
      id: randomUUID(),
      feedId,
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    this.database
      .prepare(
        `INSERT INTO feed_subscriptions
         (id, owner_id, feed_id, enabled, created_at) VALUES (?, ?, ?, 1, ?)`
      )
      .run(value.id, ownerId, value.feedId, value.createdAt)
    return value
  }

  setSubscriptionEnabled(
    ownerId: string,
    subscriptionId: string,
    enabled: boolean
  ): SubscriptionDto | undefined {
    const result = this.database
      .prepare(
        "UPDATE feed_subscriptions SET enabled = ? WHERE id = ? AND owner_id = ?"
      )
      .run(enabled ? 1 : 0, subscriptionId, ownerId)
    return result.changes === 0
      ? undefined
      : this.getSubscription(ownerId, subscriptionId)
  }

  deleteSubscription(ownerId: string, subscriptionId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM feed_subscriptions WHERE id = ? AND owner_id = ?")
        .run(subscriptionId, ownerId).changes > 0
    )
  }

  getSettings(ownerId: string): GenerationSchedule {
    const row = this.database
      .prepare(
        `SELECT schedule_enabled, schedule_local_time, schedule_time_zone
         FROM user_settings WHERE owner_id = ?`
      )
      .get(ownerId) as Record<string, unknown> | undefined
    return row
      ? toSchedule(row)
      : { enabled: false, localTime: "07:30", timeZone: "Asia/Tokyo" }
  }

  setSettings(
    ownerId: string,
    schedule: GenerationSchedule
  ): GenerationSchedule {
    this.database
      .prepare(
        `INSERT INTO user_settings
         (owner_id, schedule_enabled, schedule_local_time, schedule_time_zone)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           schedule_enabled = excluded.schedule_enabled,
           schedule_local_time = excluded.schedule_local_time,
           schedule_time_zone = excluded.schedule_time_zone`
      )
      .run(
        ownerId,
        schedule.enabled ? 1 : 0,
        schedule.localTime,
        schedule.timeZone
      )
    return schedule
  }

  listEnabledFeedIds(ownerId: string): Promise<readonly string[]> {
    return Promise.resolve(
      this.database
        .prepare(
          `SELECT feed_id FROM feed_subscriptions
         WHERE owner_id = ? AND enabled = 1 ORDER BY feed_id`
        )
        .all(ownerId)
        .map((row) => String((row as Record<string, unknown>).feed_id))
    )
  }

  create(input: {
    readonly ownerId: string
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly trigger: "manual" | "scheduled"
    readonly feedIds: readonly string[]
    readonly traceContext?: EpisodeTraceContext
  }): Promise<EpisodeJobRecord> {
    const existing = this.database
      .prepare(
        `SELECT id, owner_id, request_hash, created_at FROM episode_jobs
         WHERE owner_id = ? AND idempotency_route = ? AND idempotency_key = ?`
      )
      .get(input.ownerId, "/v1/episode-jobs", input.idempotencyKey) as
      | Record<string, unknown>
      | undefined
    if (existing) {
      if (existing.request_hash !== input.requestHash) {
        throw new IdempotencyConflictError()
      }
      return Promise.resolve({
        jobId: String(existing.id),
        ownerId: String(existing.owner_id),
        createdAt: new Date(String(existing.created_at)),
        created: false,
      })
    }

    const jobId = randomUUID()
    const createdAt = new Date().toISOString()
    const receipt = JSON.stringify({ id: jobId, status: "queued", createdAt })
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO episode_jobs
           (id, owner_id, idempotency_route, idempotency_key, request_hash,
            status, receipt_json, available_at, created_at, trace_parent,
            trace_state)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
        )
        .run(
          jobId,
          input.ownerId,
          "/v1/episode-jobs",
          input.idempotencyKey,
          input.requestHash,
          receipt,
          createdAt,
          createdAt,
          input.traceContext?.traceParent ?? null,
          input.traceContext?.traceState ?? null
        )
      const insertFeed = this.database.prepare(
        "INSERT INTO episode_job_feeds (job_id, feed_id, position) VALUES (?, ?, ?)"
      )
      input.feedIds.forEach((feedId, index) =>
        insertFeed.run(jobId, feedId, index)
      )
    })
    return Promise.resolve({
      jobId,
      ownerId: input.ownerId,
      createdAt: new Date(createdAt),
      created: true,
    })
  }

  listJobs(ownerId: string): readonly JobDto[] {
    return this.database
      .prepare(
        `SELECT * FROM episode_jobs WHERE owner_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 100`
      )
      .all(ownerId)
      .map(toJob)
  }

  getJob(ownerId: string, jobId: string): JobDto | undefined {
    const row = this.database
      .prepare("SELECT * FROM episode_jobs WHERE owner_id = ? AND id = ?")
      .get(ownerId, jobId)
    return row ? toJob(row) : undefined
  }

  cancelJob(
    ownerId: string,
    jobId: string
  ): "canceled" | "terminal" | "not_found" {
    return this.transaction(() => {
      const row = this.database
        .prepare(
          "SELECT status FROM episode_jobs WHERE owner_id = ? AND id = ?"
        )
        .get(ownerId, jobId) as Record<string, unknown> | undefined
      if (!row) return "not_found"
      if (["succeeded", "failed", "canceled"].includes(String(row.status))) {
        return "terminal"
      }
      const now = new Date().toISOString()
      this.database
        .prepare(
          `INSERT OR IGNORE INTO object_cleanup_queue
           (object_key, reason, next_attempt_at, created_at)
           SELECT object_key, 'job-canceled', ?, ?
           FROM episode_audio_chunks WHERE job_id = ?`
        )
        .run(now, now, jobId)
      this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'canceled', finished_at = ?,
           stage = NULL, lease_token = NULL, lease_expires_at = NULL,
           heartbeat_at = NULL, next_attempt_at = NULL
           WHERE id = ? AND owner_id = ?`
        )
        .run(now, jobId, ownerId)
      this.database
        .prepare(
          `UPDATE agent_runs SET status = 'canceled', finished_at = ?
           WHERE episode_job_id = ? AND owner_id = ?
             AND status IN ('queued', 'running', 'waiting_approval', 'retrying')`
        )
        .run(now, jobId, ownerId)
      this.database
        .prepare(
          `UPDATE sandbox_sessions SET state = 'stopped', stopped_at = ?
           WHERE agent_run_id IN (
             SELECT id FROM agent_runs WHERE episode_job_id = ? AND owner_id = ?
           ) AND state IN ('creating', 'ready')`
        )
        .run(now, jobId, ownerId)
      return "canceled"
    })
  }

  retryFailedJob(ownerId: string, jobId: string): JobDto | undefined {
    return this.transaction(() => {
      const original = this.database
        .prepare(
          `SELECT * FROM episode_jobs
           WHERE owner_id = ? AND id = ? AND status = 'failed'`
        )
        .get(ownerId, jobId) as Record<string, unknown> | undefined
      if (!original) return undefined
      const id = randomUUID()
      const now = new Date().toISOString()
      const receipt = JSON.stringify({ id, status: "queued", createdAt: now })
      this.database
        .prepare(
          `INSERT INTO episode_jobs
           (id, owner_id, idempotency_route, idempotency_key, request_hash,
            status, receipt_json, available_at, created_at, trace_parent,
            trace_state, retry_of_job_id, memory_version_id,
            generation_policy_hash)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          ownerId,
          `/v1/episode-jobs/${jobId}/retry`,
          id,
          String(original.request_hash),
          receipt,
          now,
          now,
          original.trace_parent ? String(original.trace_parent) : null,
          original.trace_state ? String(original.trace_state) : null,
          jobId,
          original.memory_version_id
            ? String(original.memory_version_id)
            : null,
          String(original.generation_policy_hash)
        )
      this.database
        .prepare(
          `INSERT INTO episode_job_feeds (job_id, feed_id, position)
           SELECT ?, feed_id, position FROM episode_job_feeds WHERE job_id = ?`
        )
        .run(id, jobId)
      return this.getJob(ownerId, id)
    })
  }

  leaseNext(now = new Date()): WorkerJob | undefined {
    return this.transaction(() => {
      this.reconcileJobsWithinTransaction(now)
      const timestamp = now.toISOString()
      const row = this.database
        .prepare(
          `SELECT id, owner_id, status, attempt, deadline_at,
                  generation_policy_hash,
                  trace_parent, trace_state
           FROM episode_jobs
           WHERE ((status = 'queued')
              OR (status = 'retrying' AND next_attempt_at <= ?)
              OR (status = 'running' AND lease_expires_at <= ?))
             AND attempt < 4
           ORDER BY created_at, id LIMIT 1`
        )
        .get(timestamp, timestamp) as Record<string, unknown> | undefined
      if (!row) return undefined
      const leaseToken = randomUUID()
      const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString()
      const deadlineAt = row.deadline_at
        ? String(row.deadline_at)
        : new Date(now.getTime() + 30 * 60_000).toISOString()
      const attempt = Number(row.attempt) + 1
      const recovered = String(row.status) === "running"
      const result = this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'running', attempt = ?,
           started_at = COALESCE(started_at, ?), lease_token = ?,
           lease_expires_at = ?, heartbeat_at = ?, deadline_at = ?,
           last_progress_at = COALESCE(last_progress_at, ?),
           next_attempt_at = NULL
           WHERE id = ? AND attempt < 4`
        )
        .run(
          attempt,
          timestamp,
          leaseToken,
          leaseExpiresAt,
          timestamp,
          deadlineAt,
          timestamp,
          String(row.id)
        )
      if (result.changes !== 1) throw new LeaseLostError(String(row.id))
      this.recordJobEvent(
        String(row.id),
        recovered ? "lease_recovered" : "lease_acquired",
        attempt,
        undefined,
        timestamp
      )
      return {
        id: String(row.id),
        ownerId: String(row.owner_id),
        attempt,
        leaseToken,
        leaseExpiresAt: new Date(leaseExpiresAt),
        deadlineAt: new Date(deadlineAt),
        recovered,
        generationPolicyHash: String(row.generation_policy_hash),
        ...(row.trace_parent
          ? {
              traceContext: {
                traceParent: String(row.trace_parent),
                ...(row.trace_state
                  ? { traceState: String(row.trace_state) }
                  : {}),
              },
            }
          : {}),
      }
    })
  }

  renewLease(
    jobId: string,
    leaseToken: string,
    now = new Date(),
    leaseSeconds = 60
  ): Date {
    const leaseExpiresAt = new Date(
      now.getTime() + leaseSeconds * 1000
    ).toISOString()
    const result = this.database
      .prepare(
        `UPDATE episode_jobs SET lease_expires_at = ?, heartbeat_at = ?
         WHERE id = ? AND status = 'running' AND lease_token = ?
           AND lease_expires_at > ? AND deadline_at > ?`
      )
      .run(
        leaseExpiresAt,
        now.toISOString(),
        jobId,
        leaseToken,
        now.toISOString(),
        now.toISOString()
      )
    if (result.changes !== 1) throw new LeaseLostError(jobId)
    return new Date(leaseExpiresAt)
  }

  hasActiveLease(jobId: string, leaseToken: string, now = new Date()): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM episode_jobs
           WHERE id = ? AND status = 'running' AND lease_token = ?
             AND lease_expires_at > ? AND deadline_at > ?`
        )
        .get(jobId, leaseToken, now.toISOString(), now.toISOString())
    )
  }

  reconcileJobs(now = new Date()): JobReconciliationResult {
    return this.transaction(() => this.reconcileJobsWithinTransaction(now))
  }

  getJobHealthSnapshot(now = new Date()): JobHealthSnapshot {
    const timestamp = now.toISOString()
    const statusRows = this.database
      .prepare(
        `SELECT status, COUNT(*) AS count FROM episode_jobs
         WHERE status IN ('queued', 'running', 'retrying') GROUP BY status`
      )
      .all() as readonly Record<string, unknown>[]
    const jobs = { queued: 0, running: 0, retrying: 0 }
    for (const row of statusRows) {
      const status = String(row.status) as keyof typeof jobs
      jobs[status] = Number(row.count)
    }
    const queue = this.database
      .prepare(
        `SELECT MIN(created_at) AS oldest FROM episode_jobs
         WHERE status IN ('queued', 'retrying')`
      )
      .get() as Record<string, unknown>
    const stageRows = this.database
      .prepare(
        `SELECT stage, MIN(stage_started_at) AS oldest FROM episode_jobs
         WHERE status = 'running' AND stage IS NOT NULL GROUP BY stage`
      )
      .all() as readonly Record<string, unknown>[]
    const oldestStageAgeMs: Partial<Record<JobStage, number>> = {}
    for (const row of stageRows) {
      oldestStageAgeMs[String(row.stage) as JobStage] = ageMs(row.oldest, now)
    }
    const totals = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM episode_jobs WHERE status = 'running'
            AND lease_expires_at <= ?) AS expired_leases,
          (SELECT COUNT(*) FROM object_cleanup_queue) AS cleanup_backlog,
          (SELECT COALESCE(SUM(byte_length), 0) FROM episode_audio_chunks)
            AS staging_bytes`
      )
      .get(timestamp) as Record<string, unknown>
    return {
      jobs,
      oldestQueueAgeMs: ageMs(queue.oldest, now),
      oldestStageAgeMs,
      expiredLeases: Number(totals.expired_leases),
      cleanupBacklog: Number(totals.cleanup_backlog),
      stagingBytes: Number(totals.staging_bytes),
    }
  }

  getJobFeeds(jobId: string): readonly FeedDto[] {
    return this.database
      .prepare(
        `SELECT f.id, f.name, f.site_url, f.feed_url
         FROM episode_job_feeds jf JOIN feed_catalog f ON f.id = jf.feed_id
         WHERE jf.job_id = ? ORDER BY jf.position`
      )
      .all(jobId)
      .map(toFeed)
  }

  setJobStage(
    jobId: string,
    leaseToken: string,
    stage: JobStage,
    now = new Date()
  ): void {
    const timestamp = now.toISOString()
    const result = this.database
      .prepare(
        `UPDATE episode_jobs SET stage = ?,
         stage_started_at = CASE WHEN stage IS ? THEN stage_started_at ELSE ? END,
         last_progress_at = ?, progress_completed = NULL, progress_total = NULL
         WHERE id = ? AND status = 'running' AND lease_token = ?
           AND lease_expires_at > ? AND deadline_at > ?`
      )
      .run(
        stage,
        stage,
        timestamp,
        timestamp,
        jobId,
        leaseToken,
        timestamp,
        timestamp
      )
    if (result.changes !== 1) throw new LeaseLostError(jobId)
  }

  setJobProgress(
    jobId: string,
    leaseToken: string,
    completed: number,
    total: number,
    now = new Date()
  ): void {
    if (!Number.isInteger(completed) || !Number.isInteger(total)) {
      throw new TypeError("Job progress must use integers")
    }
    if (completed < 0 || total < 1 || completed > total) {
      throw new RangeError("Job progress is out of range")
    }
    const timestamp = now.toISOString()
    const result = this.database
      .prepare(
        `UPDATE episode_jobs SET progress_completed = ?, progress_total = ?,
         last_progress_at = ?
         WHERE id = ? AND status = 'running' AND lease_token = ?
           AND lease_expires_at > ? AND deadline_at > ?`
      )
      .run(completed, total, timestamp, jobId, leaseToken, timestamp, timestamp)
    if (result.changes !== 1) throw new LeaseLostError(jobId)
  }

  getDraftCheckpoint(
    jobId: string,
    inputHash: string
  ): DraftCheckpoint | undefined {
    const row = this.database
      .prepare(
        `SELECT input_hash, title, script, source_urls_json
         FROM episode_job_drafts WHERE job_id = ? AND input_hash = ?`
      )
      .get(jobId, inputHash) as Record<string, unknown> | undefined
    if (!row) return undefined
    const urls = JSON.parse(String(row.source_urls_json)) as unknown
    if (
      !Array.isArray(urls) ||
      !urls.every((value) => typeof value === "string")
    ) {
      throw new Error("checkpoint-corrupt")
    }
    return {
      inputHash: String(row.input_hash),
      title: String(row.title),
      script: String(row.script),
      sourceUrls: urls.map((value) => new URL(value)),
    }
  }

  saveDraftCheckpoint(
    jobId: string,
    leaseToken: string,
    checkpoint: DraftCheckpoint,
    now = new Date()
  ): void {
    if (checkpoint.script.length > 6_000) {
      throw new RangeError("Podcast script exceeds 6000 characters")
    }
    this.transaction(() => {
      this.assertActiveLease(jobId, leaseToken, now)
      this.database
        .prepare(
          `INSERT INTO episode_job_drafts
           (job_id, input_hash, title, script, source_urls_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             input_hash = excluded.input_hash,
             title = excluded.title,
             script = excluded.script,
             source_urls_json = excluded.source_urls_json,
             created_at = excluded.created_at`
        )
        .run(
          jobId,
          checkpoint.inputHash,
          checkpoint.title,
          checkpoint.script,
          JSON.stringify(checkpoint.sourceUrls.map((url) => url.href)),
          now.toISOString()
        )
    })
  }

  listAudioChunkCheckpoints(
    jobId: string,
    inputHash: string
  ): readonly AudioChunkCheckpoint[] {
    return this.database
      .prepare(
        `SELECT position, object_key, content_hash, byte_length
         FROM episode_audio_chunks
         WHERE job_id = ? AND input_hash = ? ORDER BY position`
      )
      .all(jobId, inputHash)
      .map((row) => {
        const value = row as Record<string, unknown>
        return {
          position: Number(value.position),
          objectKey: String(value.object_key),
          contentHash: String(value.content_hash),
          byteLength: Number(value.byte_length),
        }
      })
  }

  saveAudioChunkCheckpoint(
    jobId: string,
    leaseToken: string,
    inputHash: string,
    checkpoint: AudioChunkCheckpoint,
    now = new Date()
  ): void {
    this.transaction(() => {
      this.assertActiveLease(jobId, leaseToken, now)
      this.database
        .prepare(
          `INSERT INTO episode_audio_chunks
           (job_id, input_hash, position, object_key, content_hash,
            byte_length, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id, input_hash, position) DO UPDATE SET
             object_key = excluded.object_key,
             content_hash = excluded.content_hash,
             byte_length = excluded.byte_length,
             created_at = excluded.created_at`
        )
        .run(
          jobId,
          inputHash,
          checkpoint.position,
          checkpoint.objectKey,
          checkpoint.contentHash,
          checkpoint.byteLength,
          now.toISOString()
        )
    })
  }

  enqueueAudioChunkCleanup(
    jobId: string,
    reason: string,
    now = new Date()
  ): number {
    return this.transaction(() => {
      const rows = this.database
        .prepare("SELECT object_key FROM episode_audio_chunks WHERE job_id = ?")
        .all(jobId) as readonly Record<string, unknown>[]
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO object_cleanup_queue
         (object_key, reason, next_attempt_at, created_at) VALUES (?, ?, ?, ?)`
      )
      for (const row of rows) {
        insert.run(
          String(row.object_key),
          reason,
          now.toISOString(),
          now.toISOString()
        )
      }
      return rows.length
    })
  }

  leaseObjectCleanup(now = new Date()): ObjectCleanupCandidate | undefined {
    return this.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT object_key, attempt FROM object_cleanup_queue
           WHERE next_attempt_at <= ? AND attempt < 20
           ORDER BY created_at, object_key LIMIT 1`
        )
        .get(now.toISOString()) as Record<string, unknown> | undefined
      if (!row) return undefined
      this.database
        .prepare(
          `UPDATE object_cleanup_queue SET attempt = attempt + 1,
           next_attempt_at = ? WHERE object_key = ?`
        )
        .run(
          new Date(now.getTime() + 60_000).toISOString(),
          String(row.object_key)
        )
      return {
        objectKey: String(row.object_key),
        attempt: Number(row.attempt) + 1,
      }
    })
  }

  completeObjectCleanup(objectKey: string): void {
    this.transaction(() => {
      this.database
        .prepare("DELETE FROM episode_audio_chunks WHERE object_key = ?")
        .run(objectKey)
      this.database
        .prepare("DELETE FROM object_cleanup_queue WHERE object_key = ?")
        .run(objectKey)
    })
  }

  failObjectCleanup(
    objectKey: string,
    message: string,
    now = new Date()
  ): void {
    this.database
      .prepare(
        `UPDATE object_cleanup_queue SET last_error = ?, next_attempt_at = ?
         WHERE object_key = ?`
      )
      .run(
        message.slice(0, 500),
        new Date(now.getTime() + 5 * 60_000).toISOString(),
        objectKey
      )
  }

  retryJob(
    jobId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    failure: JobFailureDto
  ): void {
    const result = this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'retrying', next_attempt_at = ?,
         failure_code = ?, failure_message = ?, failure_retryable = 1,
         lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
         WHERE id = ? AND status = 'running' AND lease_token = ?`
      )
      .run(
        nextAttemptAt.toISOString(),
        failure.code,
        failure.message,
        jobId,
        leaseToken
      )
    if (result.changes !== 1) throw new LeaseLostError(jobId)
  }

  failJob(jobId: string, leaseToken: string, failure: JobFailureDto): void {
    const result = this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'failed', finished_at = ?,
         failure_code = ?, failure_message = ?, failure_retryable = ?,
         lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
         WHERE id = ? AND status = 'running' AND lease_token = ?`
      )
      .run(
        new Date().toISOString(),
        failure.code,
        failure.message,
        failure.retryable ? 1 : 0,
        jobId,
        leaseToken
      )
    if (result.changes !== 1) throw new LeaseLostError(jobId)
  }

  completeJob(input: {
    readonly jobId: string
    readonly episodeId: string
    readonly ownerId: string
    readonly leaseToken: string
    readonly title: string
    readonly script: string
    readonly audioKey: string
    readonly audioByteLength: number
    readonly sources: readonly EpisodeSourceDto[]
  }): string {
    return this.transaction(() => {
      const episodeId = input.episodeId
      const createdAt = new Date().toISOString()
      this.database
        .prepare(
          `INSERT INTO episodes
           (id, owner_id, title, script, audio_key, audio_byte_length, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          episodeId,
          input.ownerId,
          input.title,
          input.script,
          input.audioKey,
          input.audioByteLength,
          createdAt
        )
      const insertSource = this.database.prepare(
        `INSERT INTO episode_sources
         (episode_id, position, url, title, published_at, snapshot_id, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      input.sources.forEach((source, index) =>
        insertSource.run(
          episodeId,
          index,
          source.url,
          source.title,
          source.publishedAt ?? null,
          source.snapshotId ?? null,
          source.sourceKind ?? "rss"
        )
      )
      const result = this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'succeeded', episode_id = ?,
           finished_at = ?, stage = NULL, lease_token = NULL,
           lease_expires_at = NULL, heartbeat_at = NULL
           WHERE id = ? AND status = 'running' AND lease_token = ?
             AND lease_expires_at > ? AND deadline_at > ?`
        )
        .run(
          episodeId,
          createdAt,
          input.jobId,
          input.leaseToken,
          createdAt,
          createdAt
        )
      if (result.changes !== 1) throw new LeaseLostError(input.jobId)
      return episodeId
    })
  }

  private reconcileJobsWithinTransaction(now: Date): JobReconciliationResult {
    const timestamp = now.toISOString()
    const deadline = this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'failed', finished_at = ?,
         failure_code = 'job-deadline-exceeded',
         failure_message = '生成処理が30分の上限を超えました。',
         failure_retryable = 1, lease_token = NULL, lease_expires_at = NULL,
         heartbeat_at = NULL, next_attempt_at = NULL
         WHERE status IN ('queued', 'running', 'retrying')
           AND deadline_at IS NOT NULL AND deadline_at <= ?`
      )
      .run(timestamp, timestamp)
    const attempts = this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'failed', finished_at = ?,
         failure_code = 'attempt-limit-exceeded',
         failure_message = '自動試行の上限4回に達しました。',
         failure_retryable = 1, lease_token = NULL, lease_expires_at = NULL,
         heartbeat_at = NULL, next_attempt_at = NULL
         WHERE (status IN ('queued', 'retrying') AND attempt >= 4)
            OR (status = 'running' AND attempt >= 4 AND lease_expires_at <= ?)`
      )
      .run(timestamp, timestamp)
    return {
      deadlineExceeded: Number(deadline.changes),
      attemptLimitExceeded: Number(attempts.changes),
    }
  }

  private recordJobEvent(
    jobId: string,
    eventType: string,
    attempt: number,
    stage: JobStage | undefined,
    createdAt: string,
    payload: Readonly<Record<string, unknown>> = {}
  ): void {
    this.database
      .prepare(
        `INSERT INTO episode_job_events
         (id, job_id, event_type, attempt, stage, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        jobId,
        eventType,
        attempt,
        stage ?? null,
        JSON.stringify(payload),
        createdAt
      )
  }

  private assertActiveLease(
    jobId: string,
    leaseToken: string,
    now: Date
  ): void {
    if (!this.hasActiveLease(jobId, leaseToken, now)) {
      throw new LeaseLostError(jobId)
    }
  }

  listEpisodes(ownerId: string): readonly EpisodeDto[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, script, created_at FROM episodes
         WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`
      )
      .all(ownerId)
    return rows.map((row) => this.toEpisode(row))
  }

  getEpisode(ownerId: string, episodeId: string): EpisodeDto | undefined {
    const row = this.database
      .prepare(
        `SELECT id, title, script, created_at FROM episodes
         WHERE owner_id = ? AND id = ?`
      )
      .get(ownerId, episodeId)
    return row ? this.toEpisode(row) : undefined
  }

  getAudio(
    ownerId: string,
    episodeId: string
  ): { key: string; size: number } | undefined {
    const row = this.database
      .prepare(
        `SELECT audio_key, audio_byte_length FROM episodes
         WHERE owner_id = ? AND id = ? AND audio_key IS NOT NULL`
      )
      .get(ownerId, episodeId) as Record<string, unknown> | undefined
    return row
      ? { key: String(row.audio_key), size: Number(row.audio_byte_length) }
      : undefined
  }

  listScheduledOwners(): readonly ScheduledOwner[] {
    return this.database
      .prepare(
        `SELECT owner_id, schedule_enabled, schedule_local_time,
         schedule_time_zone, last_scheduled_local_date
         FROM user_settings WHERE schedule_enabled = 1`
      )
      .all()
      .map((row) => {
        const value = row as Record<string, unknown>
        return {
          ownerId: String(value.owner_id),
          schedule: toSchedule(value),
          ...(value.last_scheduled_local_date
            ? {
                lastScheduledLocalDate: String(value.last_scheduled_local_date),
              }
            : {}),
        }
      })
  }

  markScheduled(ownerId: string, localDate: string): void {
    this.database
      .prepare(
        "UPDATE user_settings SET last_scheduled_local_date = ? WHERE owner_id = ?"
      )
      .run(localDate, ownerId)
  }

  private getSubscription(
    ownerId: string,
    subscriptionId: string
  ): SubscriptionDto | undefined {
    const row = this.database
      .prepare(
        `SELECT id, feed_id, enabled, created_at FROM feed_subscriptions
         WHERE owner_id = ? AND id = ?`
      )
      .get(ownerId, subscriptionId)
    return row ? toSubscription(row) : undefined
  }

  private articleRows(ownerId: string, articleId?: string, limit = 100) {
    return this.database
      .prepare(
        `SELECT i.id, i.feed_id, f.name AS source_name, i.title, i.url,
                i.published_at, i.summary, i.discovered_at, i.archive_status,
                i.latest_snapshot_id, COALESCE(s.read, 0) AS read,
                COALESCE(s.saved, 0) AS saved
         FROM feed_items i
         JOIN feed_catalog f ON f.id = i.feed_id
         JOIN feed_subscriptions sub
           ON sub.feed_id = i.feed_id AND sub.owner_id = ?
         LEFT JOIN article_user_states s
           ON s.feed_item_id = i.id AND s.owner_id = ?
         WHERE sub.enabled = 1 AND (? IS NULL OR i.id = ?)
         ORDER BY COALESCE(i.published_at, i.discovered_at) DESC, i.id DESC
         LIMIT ?`
      )
      .all(ownerId, ownerId, articleId ?? null, articleId ?? null, limit)
  }

  private toEpisode(row: unknown): EpisodeDto {
    const value = row as Record<string, unknown>
    const sources = this.database
      .prepare(
        `SELECT url, title, published_at, snapshot_id, source_kind
         FROM episode_sources
         WHERE episode_id = ? ORDER BY position`
      )
      .all(String(value.id))
      .map((source) => {
        const item = source as Record<string, unknown>
        return {
          url: String(item.url),
          title: String(item.title),
          ...(item.published_at
            ? { publishedAt: String(item.published_at) }
            : {}),
          ...(item.snapshot_id ? { snapshotId: String(item.snapshot_id) } : {}),
          sourceKind: String(item.source_kind ?? "rss") as "rss" | "web",
        }
      })
    return {
      id: String(value.id),
      title: String(value.title),
      script: String(value.script),
      sources,
      createdAt: String(value.created_at),
    }
  }

  private applyMigrations(): void {
    this.database.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations
       (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
    )
    const directory = new URL("../../migrations/", import.meta.url)
    for (const name of readdirSync(directory).sort()) {
      this.transaction(() => {
        const applied = this.database
          .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
          .get(name)
        if (applied) return
        const sql = readFileSync(new URL(name, directory), "utf8")
        this.database.exec(sql)
        this.database
          .prepare(
            "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
          )
          .run(name, new Date().toISOString())
      })
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const result = operation()
      this.database.exec("COMMIT")
      return result
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}

function toFeed(row: unknown): FeedDto {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    name: String(value.name),
    siteUrl: String(value.site_url),
    feedUrl: String(value.feed_url),
  }
}

function toSubscription(row: unknown): SubscriptionDto {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    feedId: String(value.feed_id),
    enabled: Boolean(value.enabled),
    createdAt: String(value.created_at),
  }
}

function toArticle(row: unknown): ArticleDto {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    feedId: String(value.feed_id),
    sourceName: String(value.source_name),
    title: String(value.title),
    url: String(value.url),
    ...(value.published_at ? { publishedAt: String(value.published_at) } : {}),
    ...(value.summary ? { summary: String(value.summary) } : {}),
    discoveredAt: String(value.discovered_at),
    archiveStatus: String(value.archive_status) as ArticleDto["archiveStatus"],
    ...(value.latest_snapshot_id
      ? { snapshotId: String(value.latest_snapshot_id) }
      : {}),
    read: Boolean(value.read),
    saved: Boolean(value.saved),
  }
}

function toSchedule(row: Record<string, unknown>): GenerationSchedule {
  return {
    enabled: Boolean(row.schedule_enabled),
    localTime: String(row.schedule_local_time),
    timeZone: String(row.schedule_time_zone),
  }
}

function ageMs(value: unknown, now: Date): number {
  if (!value) return 0
  const timestamp = Date.parse(String(value))
  return Number.isFinite(timestamp) ? Math.max(0, now.getTime() - timestamp) : 0
}

function toJob(row: unknown): JobDto {
  const value = row as Record<string, unknown>
  const failure = value.failure_code
    ? {
        code: String(value.failure_code),
        message: String(value.failure_message),
        retryable: Boolean(value.failure_retryable),
      }
    : undefined
  return {
    id: String(value.id),
    status: String(value.status) as JobStatus,
    createdAt: String(value.created_at),
    attempt: Number(value.attempt),
    maxAttempts: Number(value.max_attempts),
    ...(value.stage ? { stage: String(value.stage) as JobStage } : {}),
    ...(value.stage_started_at
      ? { stageStartedAt: String(value.stage_started_at) }
      : {}),
    ...(value.last_progress_at
      ? { lastProgressAt: String(value.last_progress_at) }
      : {}),
    ...(value.deadline_at ? { deadlineAt: String(value.deadline_at) } : {}),
    ...(value.progress_completed !== null && value.progress_total !== null
      ? {
          stageProgress: {
            completed: Number(value.progress_completed),
            total: Number(value.progress_total),
          },
        }
      : {}),
    ...(value.started_at ? { startedAt: String(value.started_at) } : {}),
    ...(value.finished_at ? { finishedAt: String(value.finished_at) } : {}),
    ...(value.next_attempt_at
      ? { nextAttemptAt: String(value.next_attempt_at) }
      : {}),
    ...(value.episode_id ? { episodeId: String(value.episode_id) } : {}),
    ...(failure ? { failure } : {}),
  }
}
