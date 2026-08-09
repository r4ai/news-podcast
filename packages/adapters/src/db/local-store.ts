import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import type {
  EpisodeJobRecord,
  EpisodeJobRepository,
  GenerationSchedule,
} from "@news-podcast/application"
import type { JobStatus } from "@news-podcast/domain"

export type JobStage =
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
  readonly stage?: JobStage
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly nextAttemptAt?: string
  readonly episodeId?: string
  readonly failure?: JobFailureDto
}

export interface EpisodeSourceDto {
  readonly url: string
  readonly title: string
  readonly publishedAt?: string
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
    for (const feed of this.listFeeds()) {
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
            status, receipt_json, available_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
        )
        .run(
          jobId,
          input.ownerId,
          "/v1/episode-jobs",
          input.idempotencyKey,
          input.requestHash,
          receipt,
          createdAt,
          createdAt
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

  leaseNext(now = new Date()): WorkerJob | undefined {
    return this.transaction(() => {
      const timestamp = now.toISOString()
      const row = this.database
        .prepare(
          `SELECT id, owner_id, attempt FROM episode_jobs
           WHERE (status = 'queued')
              OR (status = 'retrying' AND next_attempt_at <= ?)
              OR (status = 'running' AND lease_expires_at <= ?)
           ORDER BY created_at, id LIMIT 1`
        )
        .get(timestamp, timestamp) as Record<string, unknown> | undefined
      if (!row) return undefined
      const leaseToken = randomUUID()
      const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString()
      const attempt = Number(row.attempt) + 1
      this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'running', attempt = ?,
           started_at = COALESCE(started_at, ?), lease_token = ?,
           lease_expires_at = ?, next_attempt_at = NULL
           WHERE id = ?`
        )
        .run(attempt, timestamp, leaseToken, leaseExpiresAt, String(row.id))
      return {
        id: String(row.id),
        ownerId: String(row.owner_id),
        attempt,
        leaseToken,
      }
    })
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

  setJobStage(jobId: string, leaseToken: string, stage: JobStage): void {
    this.database
      .prepare(
        "UPDATE episode_jobs SET stage = ? WHERE id = ? AND lease_token = ?"
      )
      .run(stage, jobId, leaseToken)
  }

  retryJob(
    jobId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    failure: JobFailureDto
  ): void {
    this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'retrying', next_attempt_at = ?,
         failure_code = ?, failure_message = ?, failure_retryable = 1,
         lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_token = ?`
      )
      .run(
        nextAttemptAt.toISOString(),
        failure.code,
        failure.message,
        jobId,
        leaseToken
      )
  }

  failJob(jobId: string, leaseToken: string, failure: JobFailureDto): void {
    this.database
      .prepare(
        `UPDATE episode_jobs SET status = 'failed', finished_at = ?,
         failure_code = ?, failure_message = ?, failure_retryable = ?,
         lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_token = ?`
      )
      .run(
        new Date().toISOString(),
        failure.code,
        failure.message,
        failure.retryable ? 1 : 0,
        jobId,
        leaseToken
      )
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
         (episode_id, position, url, title, published_at) VALUES (?, ?, ?, ?, ?)`
      )
      input.sources.forEach((source, index) =>
        insertSource.run(
          episodeId,
          index,
          source.url,
          source.title,
          source.publishedAt ?? null
        )
      )
      const result = this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'succeeded', episode_id = ?,
           finished_at = ?, stage = NULL, lease_token = NULL,
           lease_expires_at = NULL WHERE id = ? AND lease_token = ?`
        )
        .run(episodeId, createdAt, input.jobId, input.leaseToken)
      if (result.changes !== 1) throw new Error("job-lease-lost")
      return episodeId
    })
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

  private toEpisode(row: unknown): EpisodeDto {
    const value = row as Record<string, unknown>
    const sources = this.database
      .prepare(
        `SELECT url, title, published_at FROM episode_sources
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

function toSchedule(row: Record<string, unknown>): GenerationSchedule {
  return {
    enabled: Boolean(row.schedule_enabled),
    localTime: String(row.schedule_local_time),
    timeZone: String(row.schedule_time_zone),
  }
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
    ...(value.stage ? { stage: String(value.stage) as JobStage } : {}),
    ...(value.started_at ? { startedAt: String(value.started_at) } : {}),
    ...(value.finished_at ? { finishedAt: String(value.finished_at) } : {}),
    ...(value.next_attempt_at
      ? { nextAttemptAt: String(value.next_attempt_at) }
      : {}),
    ...(value.episode_id ? { episodeId: String(value.episode_id) } : {}),
    ...(failure ? { failure } : {}),
  }
}
