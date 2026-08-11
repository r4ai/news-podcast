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
import {
  computeProfileHash,
  ENRICH_LEASE_MS,
  MAX_ENRICH_ATTEMPTS,
  NEW_ARTICLE_PRIORITY,
  REPROCESS_PRIORITY,
  RELEVANCE_PROMPT_VERSION,
  SUMMARY_PROMPT_VERSION,
} from "../ai-enrich/shared.js"

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
  readonly readLater: boolean
  readonly hidden: boolean
  readonly hiddenAt?: string
  readonly usedInEpisode: boolean
  // 日本語のMarkdown要約（約300字）。要約が未生成、または現行prompt_versionと不一致なら未設定。
  readonly aiSummary?: string
  // 0-100。現行profile_hash/prompt_versionに一致する行が無ければ未設定（=未処理）。
  readonly relevanceScore?: number
  readonly relevanceReason?: string
  // 手動+AI付与タグ名の和集合（重複なし）。未付与なら空配列。
  readonly tags: readonly string[]
}

export interface TagDto {
  readonly id: string
  readonly name: string
  readonly createdAt: string
}

export interface TagSuggestionDto {
  readonly name: string
  readonly occurrences: number
  readonly lastSeenAt: string
}

export interface ReadingDictionaryDto {
  readonly id: string
  readonly surface: string
  readonly reading: string
  readonly accentType: number
  readonly wordUuid: string | null
  readonly source: "manual" | "ai_auto"
  readonly episodeJobId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type ArticleListState = "all" | "unread" | "saved" | "later"
export type ArticleListSort = "newest" | "oldest" | "source" | "relevance"

export interface ArticleListOptions {
  readonly cursor?: string
  readonly limit?: number
  readonly q?: string
  readonly state?: ArticleListState
  readonly feedIds?: readonly string[]
  readonly sort?: ArticleListSort
  // 既定ではhiddenな記事を除外する。trueで含める。
  readonly includeHidden?: boolean
  readonly usedInEpisode?: boolean
  // 指定時、未処理（スコア無し）記事も含めて relevanceScore >= minScore のみ返す。
  // 未処理記事はスコア無し扱いのためminScore指定時は除外される。
  readonly minScore?: number
  // 期間絞り込み（両端を含む閉区間）。ソート基準と揃えCOALESCE(published_at, discovered_at)を対象にする。
  readonly publishedAfter?: string
  readonly publishedBefore?: string
  // 複数指定可。未指定時は全archive_statusを対象にする。
  readonly archiveStatus?: readonly ArticleDto["archiveStatus"][]
  // 指定時、いずれかのタグIDが付いている記事のみ返す（OR条件）。
  readonly tagIds?: readonly string[]
}

export interface InterestProfileDto {
  readonly include: string
  readonly exclude: string
}

export interface ArticleListResult {
  readonly items: readonly ArticleDto[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export interface ArticleFacets {
  readonly states: {
    readonly all: number
    readonly unread: number
    readonly saved: number
    readonly later: number
  }
  readonly feeds: readonly {
    readonly feedId: string
    readonly name: string
    readonly count: number
  }[]
  // 一覧の隅に出す「AI処理待ちN件」用。絞り込み条件には依存しない
  // （購読全体に対するAI補助バッチの未処理件数）。
  readonly aiPending: number
}

export type EnrichQueueStatus = "queued" | "processing" | "succeeded" | "failed"

// enrich_queue の1行を記事タイトル等と結合した表示用DTO。
export interface EnrichQueueItem {
  readonly feedItemId: string
  readonly title: string
  readonly sourceName: string
  readonly priority: number
  readonly reason: "new" | "reprocess"
  readonly status: EnrichQueueStatus
  readonly attempt: number
  readonly error?: string
  readonly publishedAt?: string
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
}

// GET /v1/me/enrich/queue の応答。処理中/待ち/失敗/直近/日次上限/再処理可能件数。
export interface EnrichQueueStatusDto {
  readonly processing: readonly EnrichQueueItem[]
  readonly pending: {
    readonly count: number
    readonly items: readonly EnrichQueueItem[]
  }
  readonly failed: {
    readonly count: number
    readonly items: readonly EnrichQueueItem[]
  }
  readonly recent: readonly EnrichQueueItem[]
  readonly daily: { readonly used: number; readonly limit: number }
  readonly reprocessable: { readonly count: number }
}

// workerがclaimしたバッチ1件分。ensureSummaryに必要な情報を持つ。
export interface EnrichClaim {
  readonly feedItemId: string
  readonly title: string
  readonly snapshotId: string
  readonly markdownKey: string
}

export interface ArticleStateInput {
  readonly read?: boolean
  readonly saved?: boolean
  readonly readLater?: boolean
  readonly hidden?: boolean
}

export interface ArticleBulkStateFilter {
  readonly q?: string
  readonly state?: ArticleListState
  readonly feedIds?: readonly string[]
  readonly includeHidden?: boolean
  readonly publishedAfter?: string
  readonly publishedBefore?: string
  readonly archiveStatus?: readonly ArticleDto["archiveStatus"][]
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
  readonly articleIds?: readonly string[]
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

export interface JobEventDto {
  readonly sequence: number
  readonly eventType: string
  readonly attempt: number
  readonly stage?: JobStage
  readonly payload: Readonly<Record<string, unknown>>
  readonly createdAt: string
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

  listArticles(
    ownerId: string,
    options: ArticleListOptions = {}
  ): ArticleListResult {
    const limit = clampArticleLimit(options.limit)
    // sort=relevanceまたはminScore指定時のみ、順序付け/絞り込みにarticle_relevanceを
    // 結合する（他の呼び出しでは無駄な結合を避ける）。スコアは最新のsucceeded行を
    // 使う（profile_hash/prompt_versionは問わない）。
    const needsRelevanceJoin =
      (options.sort ?? "newest") === "relevance" ||
      options.minScore !== undefined
    const columns = articleSortColumns(options.sort ?? "newest")
    const filters = this.articleFilterPredicate(options)
    const minScoreFilter =
      needsRelevanceJoin && options.minScore !== undefined
        ? {
            sql: "COALESCE(rel.score, -1) >= CAST(? AS INTEGER)",
            params: [String(options.minScore)],
          }
        : undefined
    const cursorValues = options.cursor
      ? decodeArticleCursor(options.cursor)
      : undefined
    const keyset =
      cursorValues && cursorValues.length === columns.length
        ? keysetPredicate(columns, cursorValues)
        : undefined

    const where = [
      filters.sql,
      ...(minScoreFilter ? [minScoreFilter.sql] : []),
      ...(keyset ? [keyset.sql] : []),
    ].join(" AND ")
    const params = [
      ownerId,
      ownerId,
      ...(needsRelevanceJoin ? [ownerId] : []),
      ...filters.params,
      ...(minScoreFilter ? minScoreFilter.params : []),
      ...(keyset ? keyset.params : []),
    ]
    const orderBy = columns
      .map((column) => `${column.expr} ${column.direction}`)
      .join(", ")
    const from = needsRelevanceJoin
      ? `${ARTICLE_FROM}
         LEFT JOIN article_relevance rel
           ON rel.feed_item_id = i.id AND rel.owner_id = ?
              AND rel.status = 'succeeded'`
      : ARTICLE_FROM
    // sort=relevanceのkeysetカーソルはscore_missing/score列を必要とする
    // （articleSortColumnsのalias参照先）。ARTICLE_SELECTには無いのでここで足す。
    const select = needsRelevanceJoin
      ? `${ARTICLE_SELECT},
         CASE WHEN rel.score IS NULL THEN '1' ELSE '0' END AS score_missing,
         printf('%05d', COALESCE(rel.score, -1) + 1) AS score`
      : ARTICLE_SELECT

    const rows = this.database
      .prepare(
        `SELECT ${select}
         ${from}
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ?`
      )
      .all(...params, limit + 1) as Record<string, unknown>[]

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore
      ? encodeCursorFor(columns, pageRows.at(-1))
      : undefined

    return {
      items: this.attachAiEnrichment(ownerId, pageRows.map(toArticle)),
      hasMore,
      ...(nextCursor ? { nextCursor } : {}),
    }
  }

  listArticleFacets(
    ownerId: string,
    options: {
      readonly q?: string
      readonly feedIds?: readonly string[]
      readonly includeHidden?: boolean
      readonly publishedAfter?: string
      readonly publishedBefore?: string
      readonly archiveStatus?: readonly ArticleDto["archiveStatus"][]
      readonly tagIds?: readonly string[]
    } = {}
  ): ArticleFacets {
    const filters = this.articleFilterPredicate(options)
    const params = [ownerId, ownerId, ...filters.params]

    const stateRow = this.database
      .prepare(
        `SELECT
           COUNT(*) AS all_count,
           SUM(CASE WHEN COALESCE(s.read, 0) = 0 THEN 1 ELSE 0 END) AS unread_count,
           SUM(CASE WHEN COALESCE(s.saved, 0) = 1 THEN 1 ELSE 0 END) AS saved_count,
           SUM(CASE WHEN COALESCE(s.read_later, 0) = 1 THEN 1 ELSE 0 END) AS later_count
         ${ARTICLE_FROM}
         WHERE ${filters.sql}`
      )
      .get(...params) as Record<string, unknown>

    const feedRows = this.database
      .prepare(
        `SELECT i.feed_id AS feed_id, f.name AS name, COUNT(*) AS count
         ${ARTICLE_FROM}
         WHERE ${filters.sql}
         GROUP BY i.feed_id, f.name
         ORDER BY f.name ASC`
      )
      .all(...params) as Record<string, unknown>[]

    return {
      states: {
        all: Number(stateRow.all_count ?? 0),
        unread: Number(stateRow.unread_count ?? 0),
        saved: Number(stateRow.saved_count ?? 0),
        later: Number(stateRow.later_count ?? 0),
      },
      feeds: feedRows.map((row) => ({
        feedId: String(row.feed_id),
        name: String(row.name),
        count: Number(row.count),
      })),
      aiPending: this.countEnrichPending(ownerId),
    }
  }

  getArticle(ownerId: string, articleId: string): ArticleDto | undefined {
    const row = this.articleRows(ownerId, articleId, 1)[0]
    if (!row) return undefined
    return this.attachAiEnrichment(ownerId, [toArticle(row)])[0]
  }

  // state/feed/検索/hidden除外の絞り込み述語を組み立てる。owner scope (sub.enabled = 1) は必ず含める。
  private articleFilterPredicate(
    options: Pick<
      ArticleListOptions,
      | "q"
      | "state"
      | "feedIds"
      | "includeHidden"
      | "usedInEpisode"
      | "publishedAfter"
      | "publishedBefore"
      | "archiveStatus"
      | "tagIds"
    >
  ): { readonly sql: string; readonly params: readonly string[] } {
    const predicates: {
      readonly sql: string
      readonly params: readonly string[]
    }[] = [
      { sql: "sub.enabled = 1", params: [] },
      articleSearchPredicate(options.q),
      { sql: articleStatePredicate(options.state), params: [] },
      { sql: articleHiddenPredicate(options.includeHidden), params: [] },
      articleFeedIdsPredicate(options.feedIds),
      articleUsedInEpisodePredicate(options.usedInEpisode),
      articlePublishedRangePredicate(
        options.publishedAfter,
        options.publishedBefore
      ),
      articleArchiveStatusPredicate(options.archiveStatus),
      articleTagsPredicate(options.tagIds),
    ]
    const active = predicates.filter((predicate) => predicate.sql !== "1=1")
    return {
      sql: active.map((predicate) => predicate.sql).join(" AND "),
      params: active.flatMap((predicate) => predicate.params),
    }
  }

  setArticleState(
    ownerId: string,
    articleId: string,
    state: ArticleStateInput
  ): ArticleDto | undefined {
    if (!this.getArticle(ownerId, articleId)) return undefined
    const current = this.database
      .prepare(
        `SELECT read, saved, read_later, hidden, hidden_at
         FROM article_user_states WHERE owner_id = ? AND feed_item_id = ?`
      )
      .get(ownerId, articleId) as Record<string, unknown> | undefined
    this.applyArticleState(
      ownerId,
      articleId,
      current,
      state,
      new Date().toISOString()
    )
    return this.getArticle(ownerId, articleId)
  }

  // 絞り込み条件に一致する全記事へ一括で状態を適用し、更新件数を返す。
  // owner scope はarticleFilterPredicateのsub.enabled = 1条件で必ず担保される。
  bulkSetArticleState(
    ownerId: string,
    filter: ArticleBulkStateFilter,
    state: ArticleStateInput
  ): number {
    return this.transaction(() => {
      const filters = this.articleFilterPredicate(filter)
      const params = [ownerId, ownerId, ...filters.params]
      const rows = this.database
        .prepare(
          `SELECT i.id AS id, s.read AS read, s.saved AS saved,
                  s.read_later AS read_later, s.hidden AS hidden,
                  s.hidden_at AS hidden_at
           ${ARTICLE_FROM}
           WHERE ${filters.sql}`
        )
        .all(...params) as Record<string, unknown>[]

      const now = new Date().toISOString()
      for (const row of rows) {
        this.applyArticleState(ownerId, String(row.id), row, state, now)
      }
      return rows.length
    })
  }

  // setArticleState/bulkSetArticleStateで共有するupsert本体。
  // hiddenがtrueへ遷移した時だけhidden_atを刻み、falseに戻したらNULLへ戻す。
  private applyArticleState(
    ownerId: string,
    articleId: string,
    current: Record<string, unknown> | undefined,
    state: ArticleStateInput,
    now: string
  ): void {
    const nextHidden = resolveBooleanField(state.hidden, current?.hidden)
    const hiddenAt = nextHidden
      ? current?.hidden_at
        ? String(current.hidden_at)
        : now
      : null
    this.database
      .prepare(
        `INSERT INTO article_user_states
         (owner_id, feed_item_id, read, saved, read_later, hidden, hidden_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, feed_item_id) DO UPDATE SET
           read = excluded.read, saved = excluded.saved,
           read_later = excluded.read_later, hidden = excluded.hidden,
           hidden_at = excluded.hidden_at, updated_at = excluded.updated_at`
      )
      .run(
        ownerId,
        articleId,
        resolveBooleanField(state.read, current?.read) ? 1 : 0,
        resolveBooleanField(state.saved, current?.saved) ? 1 : 0,
        resolveBooleanField(state.readLater, current?.read_later) ? 1 : 0,
        nextHidden ? 1 : 0,
        hiddenAt,
        now
      )
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

  // アーカイブ済みMarkdown本文をFTS索引へ投入する。feed_itemsはowner非依存
  // （購読を通じて共有される）ため、articleIdだけで一意に特定できる。
  setArticleSearchBody(articleId: string, body: string): void {
    this.database
      .prepare(
        `UPDATE feed_items_fts SET body = ?, body_indexed_at = ?
         WHERE rowid = (SELECT rowid FROM feed_items WHERE id = ?)`
      )
      .run(body, new Date().toISOString(), articleId)
  }

  // 本文が未投入（body_indexed_at IS NULL）かつアーカイブ済みの記事をN件返す。
  // ワーカーのバックフィル処理が繰り返し呼び出し、返り値が尽きるまで進める。
  listArticlesPendingBodyIndex(
    limit: number
  ): readonly { readonly id: string; readonly markdownKey: string }[] {
    return this.database
      .prepare(
        `SELECT i.id AS id, snap.markdown_key AS markdown_key
         FROM feed_items i
         JOIN feed_items_fts fts ON fts.rowid = i.rowid
         JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
         WHERE i.archive_status = 'succeeded'
           AND i.latest_snapshot_id IS NOT NULL
           AND fts.body_indexed_at IS NULL
         ORDER BY i.discovered_at, i.id
         LIMIT ?`
      )
      .all(limit)
      .map((row) => {
        const value = row as Record<string, unknown>
        return {
          id: String(value.id),
          markdownKey: String(value.markdown_key),
        }
      })
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
    limit: number,
    articleIds?: readonly string[]
  ): readonly ArticleDto[] {
    if (feedIds.length === 0) return []
    // 記事が明示選択されている場合は、それが唯一の候補集合になる。
    // limit と新着順は無視し、ユーザーが並べた順で返す。
    if (articleIds && articleIds.length > 0) {
      const selected = articleIds.map(() => "?").join(",")
      return this.database
        .prepare(
          `SELECT i.id, i.feed_id, f.name AS source_name, i.title, i.url,
                  i.published_at, i.summary, i.discovered_at, i.archive_status,
                  i.latest_snapshot_id, 0 AS read, 0 AS saved
            FROM feed_items i
            JOIN feed_catalog f ON f.id = i.feed_id
            JOIN feed_subscriptions s
              ON s.feed_id = i.feed_id AND s.owner_id = ?
            JOIN episode_job_articles a ON a.feed_item_id = i.id
           WHERE ${SELECTABLE_ITEM_PREDICATE}
             AND i.id IN (${selected})
           GROUP BY i.id
           ORDER BY MIN(a.position)`
        )
        .all(ownerId, ...articleIds)
        .map(toArticle)
    }
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
          WHERE ${SELECTABLE_ITEM_PREDICATE}
            AND i.feed_id IN (${placeholders})
         ORDER BY COALESCE(i.published_at, i.discovered_at) DESC
         LIMIT ?`
      )
      .all(ownerId, ...feedIds, limit)
      .map(toArticle)
  }

  /** ジョブに凍結された選択記事 ID を、選択順で返す。 */
  listJobArticleIds(jobId: string): readonly string[] {
    return this.database
      .prepare(
        `SELECT feed_item_id FROM episode_job_articles
         WHERE job_id = ? ORDER BY position`
      )
      .all(jobId)
      .map((row) => String((row as Record<string, unknown>).feed_item_id))
  }

  /**
   * 生成対象として選べる記事 ID だけを返す。`listAgentArticles` と同じ条件
   * （購読中・有効・アーカイブ済み）を使い、他人の記事や未アーカイブ記事を弾く。
   */
  filterSelectableArticleIds(
    ownerId: string,
    articleIds: readonly string[]
  ): readonly string[] {
    if (articleIds.length === 0) return []
    const placeholders = articleIds.map(() => "?").join(",")
    return this.database
      .prepare(
        `SELECT i.id FROM feed_items i
         JOIN feed_subscriptions s
           ON s.feed_id = i.feed_id AND s.owner_id = ? AND s.enabled = 1
         WHERE ${SELECTABLE_ITEM_PREDICATE}
           AND i.id IN (${placeholders})`
      )
      .all(ownerId, ...articleIds)
      .map((row) => String((row as Record<string, unknown>).id))
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

  getInterestProfile(ownerId: string): InterestProfileDto {
    const row = this.database
      .prepare(
        `SELECT interest_include, interest_exclude
         FROM user_settings WHERE owner_id = ?`
      )
      .get(ownerId) as Record<string, unknown> | undefined
    return {
      include: row ? String(row.interest_include ?? "") : "",
      exclude: row ? String(row.interest_exclude ?? "") : "",
    }
  }

  setInterestProfile(
    ownerId: string,
    profile: InterestProfileDto
  ): InterestProfileDto {
    const hash = computeProfileHash(profile.include, profile.exclude)
    this.database
      .prepare(
        `INSERT INTO user_settings
         (owner_id, interest_include, interest_exclude, interest_profile_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           interest_include = excluded.interest_include,
           interest_exclude = excluded.interest_exclude,
           interest_profile_hash = excluded.interest_profile_hash`
      )
      .run(ownerId, profile.include, profile.exclude, hash)
    return profile
  }

  // --- タグ -------------------------------------------------------------
  // タグ語彙はowner_id+nameで一意。AIは常にこの語彙からのみ選ぶ（enrich-worker.ts参照）。

  listTags(ownerId: string): readonly TagDto[] {
    return this.database
      .prepare(
        "SELECT id, name, created_at FROM tags WHERE owner_id = ? ORDER BY name"
      )
      .all(ownerId)
      .map(toTag)
  }

  // 同名タグが既にあれば既存を返す（べき等）。
  createTag(ownerId: string, name: string): TagDto {
    const existing = this.database
      .prepare(
        "SELECT id, name, created_at FROM tags WHERE owner_id = ? AND name = ?"
      )
      .get(ownerId, name) as Record<string, unknown> | undefined
    if (existing) return toTag(existing)
    const tag: TagDto = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    }
    this.database
      .prepare(
        "INSERT INTO tags (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(tag.id, ownerId, tag.name, tag.createdAt)
    return tag
  }

  deleteTag(ownerId: string, tagId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM tags WHERE id = ? AND owner_id = ?")
        .run(tagId, ownerId).changes > 0
    )
  }

  // タグ語彙の名前一覧。AIの構造化出力enumに渡す候補（空なら呼び出し側がタグ付けをスキップする）。
  getTagVocabulary(ownerId: string): readonly string[] {
    return this.database
      .prepare("SELECT name FROM tags WHERE owner_id = ? ORDER BY name")
      .all(ownerId)
      .map((row) => String((row as Record<string, unknown>).name))
  }

  // PUT /articles/{id}/tags: 手動タグの集合をtagIdsで完全に置き換える。AI付与タグ(source='ai')は別行として残す。
  setArticleManualTags(
    ownerId: string,
    feedItemId: string,
    tagIds: readonly string[]
  ): void {
    this.transaction(() => {
      this.database
        .prepare(
          "DELETE FROM article_tags WHERE owner_id = ? AND feed_item_id = ? AND source = 'manual'"
        )
        .run(ownerId, feedItemId)
      const insert = this.database.prepare(
        `INSERT INTO article_tags (owner_id, feed_item_id, tag_id, source, confidence, created_at)
         VALUES (?, ?, ?, 'manual', NULL, ?)
         ON CONFLICT(owner_id, feed_item_id, tag_id) DO UPDATE SET source = 'manual'`
      )
      const now = new Date().toISOString()
      for (const tagId of tagIds) insert.run(ownerId, feedItemId, tagId, now)
    })
  }

  // AI補助バッチが語彙内タグを付与する（既存のsource='ai'行は上書き）。
  saveAiArticleTags(
    ownerId: string,
    feedItemId: string,
    tags: readonly { readonly name: string; readonly confidence: number }[]
  ): void {
    if (tags.length === 0) return
    this.transaction(() => {
      const now = new Date().toISOString()
      for (const tag of tags) {
        const row = this.database
          .prepare("SELECT id FROM tags WHERE owner_id = ? AND name = ?")
          .get(ownerId, tag.name) as Record<string, unknown> | undefined
        if (!row) continue // 語彙に無い名前は無視（呼び出し側でsuggestedTagsへ回すべき値）
        this.database
          .prepare(
            `INSERT INTO article_tags (owner_id, feed_item_id, tag_id, source, confidence, created_at)
             VALUES (?, ?, ?, 'ai', ?, ?)
             ON CONFLICT(owner_id, feed_item_id, tag_id) DO UPDATE SET
               confidence = excluded.confidence, created_at = excluded.created_at`
          )
          .run(ownerId, feedItemId, String(row.id), tag.confidence, now)
      }
    })
  }

  listTagSuggestions(ownerId: string): readonly TagSuggestionDto[] {
    return this.database
      .prepare(
        `SELECT name, occurrences, last_seen_at FROM tag_suggestions
         WHERE owner_id = ? ORDER BY occurrences DESC, last_seen_at DESC`
      )
      .all(ownerId)
      .map(toTagSuggestion)
  }

  // 語彙に無いタグ名をAIが出した場合の受け皿。既にあれば出現回数を積み増す。
  recordTagSuggestions(ownerId: string, names: readonly string[]): void {
    if (names.length === 0) return
    const now = new Date().toISOString()
    const upsert = this.database.prepare(
      `INSERT INTO tag_suggestions (owner_id, name, occurrences, last_seen_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(owner_id, name) DO UPDATE SET
         occurrences = occurrences + 1, last_seen_at = excluded.last_seen_at`
    )
    this.transaction(() => {
      for (const name of new Set(names)) upsert.run(ownerId, name, now)
    })
  }

  // 提案からタグ語彙へ昇格させる。作成後は提案行を消す。
  promoteTagSuggestion(ownerId: string, name: string): TagDto | undefined {
    const suggestion = this.database
      .prepare("SELECT 1 FROM tag_suggestions WHERE owner_id = ? AND name = ?")
      .get(ownerId, name)
    if (!suggestion) return undefined
    return this.transaction(() => {
      const tag = this.createTag(ownerId, name)
      this.database
        .prepare("DELETE FROM tag_suggestions WHERE owner_id = ? AND name = ?")
        .run(ownerId, name)
      return tag
    })
  }

  // AI補助バッチが対象とする所有者一覧（有効な購読を1つ以上持つ所有者）。
  listOwnersWithSubscriptions(): readonly string[] {
    return this.database
      .prepare(
        `SELECT DISTINCT owner_id FROM feed_subscriptions WHERE enabled = 1
         ORDER BY owner_id`
      )
      .all()
      .map((row) => String((row as Record<string, unknown>).owner_id))
  }

  // --- 読み辞書 ----------------------------------------------------------
  // surface（表記）とreading（読みカナ）の組をownerごとに管理。
  // VOICEVOX /user_dict_word APIと同期してTTSの読み品質を改善する。

  listReadingDictionary(
    ownerId: string,
  ): readonly ReadingDictionaryDto[] {
    return this.database
      .prepare(
        `SELECT id, surface, reading, accent_type, word_uuid, source,
                episode_job_id, created_at, updated_at
         FROM reading_dictionary WHERE owner_id = ? ORDER BY surface`
      )
      .all(ownerId)
      .map(toReadingDictionaryEntry)
  }

  addReadingDictionary(input: {
    readonly ownerId: string
    readonly surface: string
    readonly reading: string
    readonly accentType?: number
    readonly source: "manual" | "ai_auto"
    readonly episodeJobId?: string
  }): ReadingDictionaryDto {
    const now = new Date().toISOString()
    const entry: ReadingDictionaryDto = {
      id: randomUUID(),
      surface: input.surface,
      reading: input.reading,
      accentType: input.accentType ?? 0,
      wordUuid: null,
      source: input.source,
      episodeJobId: input.episodeJobId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO reading_dictionary
         (id, owner_id, surface, reading, accent_type, word_uuid, source,
          episode_job_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        input.ownerId,
        entry.surface,
        entry.reading,
        entry.accentType,
        entry.wordUuid,
        entry.source,
        entry.episodeJobId,
        entry.createdAt,
        entry.updatedAt,
      )
    const existing = this.database
      .prepare(
        `SELECT id, surface, reading, accent_type, word_uuid, source,
                episode_job_id, created_at, updated_at
         FROM reading_dictionary WHERE owner_id = ? AND surface = ?`
      )
      .get(input.ownerId, input.surface) as Record<string, unknown> | undefined
    return existing ? toReadingDictionaryEntry(existing) : entry
  }

  updateReadingDictionary(
    ownerId: string,
    id: string,
    patch: {
      readonly surface?: string
      readonly reading?: string
      readonly accentType?: number
      readonly wordUuid?: string | null
    },
  ): ReadingDictionaryDto | null {
    const now = new Date().toISOString()
    const sets: string[] = ["updated_at = ?"]
    const params: (string | number | null)[] = [now]
    if (patch.surface !== undefined) {
      sets.push("surface = ?")
      params.push(patch.surface)
    }
    if (patch.reading !== undefined) {
      sets.push("reading = ?")
      params.push(patch.reading)
    }
    if (patch.accentType !== undefined) {
      sets.push("accent_type = ?")
      params.push(patch.accentType)
    }
    if (patch.wordUuid !== undefined) {
      sets.push("word_uuid = ?")
      params.push(patch.wordUuid)
    }
    params.push(id, ownerId)
    this.database
      .prepare(
        `UPDATE reading_dictionary SET ${sets.join(", ")}
         WHERE id = ? AND owner_id = ?`
      )
      .run(...params)
    const row = this.database
      .prepare(
        `SELECT id, surface, reading, accent_type, word_uuid, source,
                episode_job_id, created_at, updated_at
         FROM reading_dictionary WHERE id = ? AND owner_id = ?`
      )
      .get(id, ownerId) as Record<string, unknown> | undefined
    return row ? toReadingDictionaryEntry(row) : null
  }

  deleteReadingDictionary(ownerId: string, id: string): boolean {
    return (
      this.database
        .prepare(
          "DELETE FROM reading_dictionary WHERE id = ? AND owner_id = ?"
        )
        .run(id, ownerId).changes > 0
    )
  }

  // --- AI補助キュー（enrich_queue）-------------------------------------
  // 「1回処理済み」= 任意のprofile_hashでstatus='succeeded'のarticle_relevance行を持つ。
  // 興味プロフィール編集・タグ追加では自動再処理せず、未処理記事のみをreconcileで
  // 自動投入する。明示再処理はenqueueReprocess（priority=100）で後回しにされる。

  // 毎tickの自己修復。期限切れprocessingをqueuedへ戻し、未処理記事をnewとして投入する。
  reconcileEnrichQueue(now: Date = new Date()): void {
    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE enrich_queue
           SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
               started_at = NULL
           WHERE status = 'processing'
             AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`
        )
        .run(now.toISOString())
      this.database
        .prepare(
          `INSERT OR IGNORE INTO enrich_queue
           (owner_id, feed_item_id, priority, reason, status, attempt,
            published_at, created_at)
           SELECT sub.owner_id, i.id, ?, 'new', 'queued', 0,
                  COALESCE(i.published_at, i.discovered_at), ?
           FROM feed_items i
           JOIN feed_subscriptions sub
             ON sub.feed_id = i.feed_id AND sub.enabled = 1
           JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
           WHERE i.archive_status = 'succeeded'
             AND i.latest_snapshot_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM article_relevance r
               WHERE r.owner_id = sub.owner_id AND r.feed_item_id = i.id
                 AND r.status = 'succeeded'
             )`
        )
        .run(NEW_ARTICLE_PRIORITY, now.toISOString())
    })
  }

  // キューから未処理を優先度順・新着順にclaimする。BEGIN IMMEDIATEのトランザクション内で
  // SELECT→UPDATEすることで、複数workerが同じ記事を二重処理しないことを保証する。
  // 戻り値はSELECTの並び（優先度順・新着順）をそのまま保持する。
  leaseEnrichBatch(
    ownerId: string,
    limit: number,
    now: Date = new Date()
  ): readonly EnrichClaim[] {
    if (limit <= 0) return []
    const leaseToken = randomUUID()
    const expiresAt = new Date(now.getTime() + ENRICH_LEASE_MS).toISOString()
    return this.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT i.id AS feed_item_id, i.title AS title,
                  snap.id AS snapshot_id, snap.markdown_key AS markdown_key
           FROM enrich_queue q
           JOIN feed_items i ON i.id = q.feed_item_id
           JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
           WHERE q.owner_id = ? AND q.status IN ('queued', 'failed')
             AND q.attempt < ?
           ORDER BY q.priority ASC, q.published_at DESC, q.created_at ASC
           LIMIT ?`
        )
        .all(ownerId, MAX_ENRICH_ATTEMPTS, limit) as Record<string, unknown>[]
      if (rows.length === 0) return []
      const update = this.database.prepare(
        `UPDATE enrich_queue
         SET status = 'processing', lease_token = ?, lease_expires_at = ?,
             started_at = ?
         WHERE owner_id = ? AND feed_item_id = ?`
      )
      const claimed = rows.map((row) => {
        update.run(
          leaseToken,
          expiresAt,
          now.toISOString(),
          ownerId,
          String(row.feed_item_id)
        )
        return {
          feedItemId: String(row.feed_item_id),
          title: String(row.title),
          snapshotId: String(row.snapshot_id),
          markdownKey: String(row.markdown_key),
        }
      })
      return claimed
    })
  }

  // claim済みバッチの結果をキューへ反映する。succeededは終端、failedはattemptを
  // 1つ増やして再試行対象に戻す（上限超過後は終端として残る）。
  completeEnrichBatch(
    ownerId: string,
    input: {
      readonly succeeded: readonly string[]
      readonly failed: readonly {
        readonly feedItemId: string
        readonly error: string
      }[]
    },
    now: Date = new Date()
  ): void {
    this.transaction(() => {
      const succeed = this.database.prepare(
        `UPDATE enrich_queue
         SET status = 'succeeded', lease_token = NULL, lease_expires_at = NULL,
             completed_at = ?, error = NULL
         WHERE owner_id = ? AND feed_item_id = ?`
      )
      for (const feedItemId of input.succeeded) {
        succeed.run(now.toISOString(), ownerId, feedItemId)
      }
      const fail = this.database.prepare(
        `UPDATE enrich_queue
         SET status = 'failed', attempt = attempt + 1,
             lease_token = NULL, lease_expires_at = NULL,
             completed_at = ?, error = ?
         WHERE owner_id = ? AND feed_item_id = ?`
      )
      for (const item of input.failed) {
        fail.run(
          now.toISOString(),
          item.error.slice(0, 500),
          ownerId,
          item.feedItemId
        )
      }
    })
  }

  // 関連度を処理済み（成功・失敗を問わない）の記事を明示再処理として投入する。
  // 設定・記事詳細からの明示要求専用。処理中の記事は対象外。
  enqueueReprocess(ownerId: string, now: Date = new Date()): number {
    const result = this.database
      .prepare(
        `INSERT INTO enrich_queue
         (owner_id, feed_item_id, priority, reason, status, attempt,
          published_at, created_at)
         SELECT sub.owner_id, i.id, ?, 'reprocess', 'queued', 0,
                COALESCE(i.published_at, i.discovered_at), ?
         FROM feed_items i
         JOIN feed_subscriptions sub
           ON sub.feed_id = i.feed_id AND sub.owner_id = ? AND sub.enabled = 1
         JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
         WHERE i.archive_status = 'succeeded'
           AND i.latest_snapshot_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM article_relevance r
             WHERE r.owner_id = sub.owner_id AND r.feed_item_id = i.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM enrich_queue q
             WHERE q.owner_id = sub.owner_id AND q.feed_item_id = i.id
               AND q.status = 'processing'
           )
         ON CONFLICT(owner_id, feed_item_id) DO UPDATE SET
           status = 'queued', priority = excluded.priority,
           reason = excluded.reason, attempt = 0,
           lease_token = NULL, lease_expires_at = NULL,
           started_at = NULL, completed_at = NULL, error = NULL,
           created_at = excluded.created_at`
      )
      .run(REPROCESS_PRIORITY, now.toISOString(), ownerId)
    return Number(result.changes ?? 0)
  }

  // キュー状態（処理中/待ち/失敗/直近/日次上限/再処理可能件数）を返す。
  // GET /v1/me/enrich/queue の応答。
  listEnrichQueueStatus(
    ownerId: string,
    dailyLimit: number
  ): EnrichQueueStatusDto {
    const now = new Date()
    const daily = {
      used: this.getEnrichProcessedToday(toLocalDate(now)),
      limit: dailyLimit,
    }
    const queueRow = (row: Record<string, unknown>): EnrichQueueItem => ({
      feedItemId: String(row.feed_item_id),
      title: String(row.title),
      sourceName: String(row.source_name ?? ""),
      priority: Number(row.priority ?? 0),
      reason: String(row.reason) as "new" | "reprocess",
      status: String(row.status) as EnrichQueueStatus,
      attempt: Number(row.attempt ?? 0),
      ...(row.error ? { error: String(row.error) } : {}),
      ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
      createdAt: String(row.created_at),
      ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
      ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    })
    const queueSelect = `SELECT q.feed_item_id AS feed_item_id, i.title AS title,
            f.name AS source_name, q.priority AS priority, q.reason AS reason,
            q.status AS status, q.attempt AS attempt, q.error AS error,
            q.published_at AS published_at, q.created_at AS created_at,
            q.started_at AS started_at, q.completed_at AS completed_at
         FROM enrich_queue q
         JOIN feed_items i ON i.id = q.feed_item_id
         JOIN feed_catalog f ON f.id = i.feed_id
         WHERE q.owner_id = ?`
    const processing = (
      this.database
        .prepare(`${queueSelect} AND q.status = 'processing'
         ORDER BY q.started_at ASC, q.created_at ASC LIMIT 50`)
        .all(ownerId) as Record<string, unknown>[]
    ).map(queueRow)
    const pendingCount = Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS c FROM enrich_queue
             WHERE owner_id = ? AND status IN ('queued', 'processing', 'failed')
               AND attempt < ?`
          )
          .get(ownerId, MAX_ENRICH_ATTEMPTS) as Record<string, unknown>
      ).c ?? 0
    )
    const pendingItems = (
      this.database
        .prepare(`${queueSelect} AND q.status IN ('queued', 'failed')
           AND q.attempt < ?
         ORDER BY q.priority ASC, q.published_at DESC, q.created_at ASC LIMIT 50`)
        .all(ownerId, MAX_ENRICH_ATTEMPTS) as Record<string, unknown>[]
    ).map(queueRow)
    const failedCount = Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS c FROM enrich_queue
             WHERE owner_id = ? AND status = 'failed' AND attempt >= ?`
          )
          .get(ownerId, MAX_ENRICH_ATTEMPTS) as Record<string, unknown>
      ).c ?? 0
    )
    const failedItems = (
      this.database
        .prepare(`${queueSelect} AND q.status = 'failed' AND q.attempt >= ?
         ORDER BY q.completed_at DESC LIMIT 50`)
        .all(ownerId, MAX_ENRICH_ATTEMPTS) as Record<string, unknown>[]
    ).map(queueRow)
    const recent = (
      this.database
        .prepare(
          `${queueSelect} AND q.completed_at IS NOT NULL
         ORDER BY q.completed_at DESC LIMIT 20`
        )
        .all(ownerId) as Record<string, unknown>[]
    ).map(queueRow)
    const reprocessableCount = Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS c
             FROM feed_items i
             JOIN feed_subscriptions sub
               ON sub.feed_id = i.feed_id AND sub.owner_id = ? AND sub.enabled = 1
             JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
             WHERE i.archive_status = 'succeeded'
               AND i.latest_snapshot_id IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM article_relevance r
                 WHERE r.owner_id = sub.owner_id AND r.feed_item_id = i.id
               )`
          )
          .get(ownerId) as Record<string, unknown>
      ).c ?? 0
    )
    return {
      processing,
      pending: { count: pendingCount, items: pendingItems },
      failed: { count: failedCount, items: failedItems },
      recent,
      daily,
      reprocessable: { count: reprocessableCount },
    }
  }

  // 一覧の隅に出す「AI処理待ちN件」用。enrich_queueの未処理（queued/processing/再試行中failed）。
  countEnrichPending(ownerId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS pending
         FROM enrich_queue
         WHERE owner_id = ?
           AND status IN ('queued', 'processing', 'failed')
           AND attempt < ?`
      )
      .get(ownerId, MAX_ENRICH_ATTEMPTS) as Record<string, unknown>
    return Number(row.pending ?? 0)
  }

  // 現行prompt_versionの要約があればMarkdown文字列を返す。無ければundefined。
  getArticleSummary(snapshotId: string): string | undefined {
    const row = this.database
      .prepare(
        `SELECT summary_json FROM article_summaries
         WHERE snapshot_id = ? AND prompt_version = ?`
      )
      .get(snapshotId, SUMMARY_PROMPT_VERSION) as
      | Record<string, unknown>
      | undefined
    if (!row) return undefined
    const parsed = JSON.parse(String(row.summary_json)) as unknown
    return typeof parsed === "string" ? parsed : undefined
  }

  saveArticleSummary(input: {
    readonly snapshotId: string
    readonly model: string
    readonly markdown: string
    readonly tokensIn: number
    readonly tokensOut: number
  }): void {
    this.database
      .prepare(
        `INSERT INTO article_summaries
         (snapshot_id, model, prompt_version, summary_json, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(snapshot_id) DO UPDATE SET
           model = excluded.model, prompt_version = excluded.prompt_version,
           summary_json = excluded.summary_json, tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out, created_at = excluded.created_at`
      )
      .run(
        input.snapshotId,
        input.model,
        SUMMARY_PROMPT_VERSION,
        JSON.stringify(input.markdown),
        input.tokensIn,
        input.tokensOut,
        new Date().toISOString()
      )
  }

  saveArticleRelevance(input: {
    readonly ownerId: string
    readonly feedItemId: string
    readonly profileHash: string
    readonly model: string
    readonly score: number
    readonly reason: string
    readonly tokensIn: number
    readonly tokensOut: number
  }): void {
    this.upsertArticleRelevance({
      ...input,
      status: "succeeded",
      score: input.score,
      reason: input.reason,
      error: undefined,
    })
  }

  saveArticleRelevanceFailure(input: {
    readonly ownerId: string
    readonly feedItemId: string
    readonly profileHash: string
    readonly model: string
    readonly error: string
  }): void {
    this.upsertArticleRelevance({
      ...input,
      status: "failed",
      score: undefined,
      reason: undefined,
      tokensIn: 0,
      tokensOut: 0,
    })
  }

  private upsertArticleRelevance(input: {
    readonly ownerId: string
    readonly feedItemId: string
    readonly profileHash: string
    readonly model: string
    readonly status: "succeeded" | "failed"
    readonly score: number | undefined
    readonly reason: string | undefined
    readonly error: string | undefined
    readonly tokensIn: number
    readonly tokensOut: number
  }): void {
    this.database
      .prepare(
        `INSERT INTO article_relevance
         (owner_id, feed_item_id, profile_hash, model, prompt_version,
          score, reason, status, error, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, feed_item_id) DO UPDATE SET
           profile_hash = excluded.profile_hash, model = excluded.model,
           prompt_version = excluded.prompt_version, score = excluded.score,
           reason = excluded.reason, status = excluded.status,
           error = excluded.error, tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out, created_at = excluded.created_at`
      )
      .run(
        input.ownerId,
        input.feedItemId,
        input.profileHash,
        input.model,
        RELEVANCE_PROMPT_VERSION,
        input.score ?? null,
        input.reason ?? null,
        input.status,
        input.error ?? null,
        input.tokensIn,
        input.tokensOut,
        new Date().toISOString()
      )
  }

  // AI補助バッチの日次上限(AI_ENRICH_DAILY_LIMIT)をローカル日付単位で追跡する。
  getEnrichProcessedToday(localDate: string): number {
    const row = this.database
      .prepare(
        "SELECT processed_count FROM ai_enrich_daily_progress WHERE local_date = ?"
      )
      .get(localDate) as Record<string, unknown> | undefined
    return row ? Number(row.processed_count) : 0
  }

  incrementEnrichProcessed(localDate: string, by: number): void {
    if (by <= 0) return
    this.database
      .prepare(
        `INSERT INTO ai_enrich_daily_progress (local_date, processed_count)
         VALUES (?, ?)
         ON CONFLICT(local_date) DO UPDATE SET
           processed_count = processed_count + excluded.processed_count`
      )
      .run(localDate, by)
  }

  resetEnrichProcessedToday(localDate: string): void {
    this.database
      .prepare("DELETE FROM ai_enrich_daily_progress WHERE local_date = ?")
      .run(localDate)
  }

  // 記事1件を対象にした即時（オンデマンド）再処理用に、現行の候補情報を返す。
  // 既に処理済み(現行profile_hash/prompt_version一致)でも強制的に返す
  // （呼び出し側のPOST /enrichは常に再実行なため）。
  getEnrichTarget(
    ownerId: string,
    feedItemId: string
  ):
    | {
        readonly feedItemId: string
        readonly title: string
        readonly snapshotId: string
        readonly markdownKey: string
      }
    | undefined {
    const row = this.database
      .prepare(
        `SELECT i.id AS feed_item_id, i.title AS title,
                snap.id AS snapshot_id, snap.markdown_key AS markdown_key
         FROM feed_items i
         JOIN feed_subscriptions sub
           ON sub.feed_id = i.feed_id AND sub.owner_id = ? AND sub.enabled = 1
         JOIN article_snapshots snap ON snap.id = i.latest_snapshot_id
         WHERE i.id = ? AND i.archive_status = 'succeeded'
           AND i.latest_snapshot_id IS NOT NULL`
      )
      .get(ownerId, feedItemId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      feedItemId: String(row.feed_item_id),
      title: String(row.title),
      snapshotId: String(row.snapshot_id),
      markdownKey: String(row.markdown_key),
    }
  }

  // listArticles/getArticleの結果にaiSummary/relevanceScore/relevanceReasonを付与する。
  // 要約は所有者非依存（snapshot単位）。スコアは所有者の最新（profile_hash/prompt_versionに
  // 関わらず）のsucceeded行を反映する——プロフィール変更で自動再処理されなくなっても、
  // 古いプロフィールでのスコアを表示し続けるため。
  private attachAiEnrichment(
    ownerId: string,
    rows: readonly ArticleDto[]
  ): readonly ArticleDto[] {
    if (rows.length === 0) return rows
    const feedItemIds = rows.map((row) => row.id)
    const snapshotIds = [
      ...new Set(
        rows
          .map((row) => row.snapshotId)
          .filter((value): value is string => Boolean(value))
      ),
    ]

    const relevancePlaceholders = feedItemIds.map(() => "?").join(",")
    const relevanceRows = feedItemIds.length
      ? (this.database
          .prepare(
            `SELECT feed_item_id, score, reason FROM article_relevance
             WHERE owner_id = ? AND status = 'succeeded'
               AND feed_item_id IN (${relevancePlaceholders})`
          )
          .all(ownerId, ...feedItemIds) as Record<string, unknown>[])
      : []
    const relevanceMap = new Map(
      relevanceRows.map((row) => [
        String(row.feed_item_id),
        { score: Number(row.score), reason: String(row.reason) },
      ])
    )

    const summaryPlaceholders = snapshotIds.map(() => "?").join(",")
    // 表示目的ではバージョン不問で最新の要約を使う（v1配列→Markdown変換）。
    const summaryRows = snapshotIds.length
      ? (this.database
          .prepare(
            `SELECT snapshot_id, summary_json FROM article_summaries
             WHERE snapshot_id IN (${summaryPlaceholders})
             ORDER BY snapshot_id, created_at DESC`
          )
          .all(...snapshotIds) as Record<string, unknown>[])
      : []
    const seen = new Set<string>()
    const summaryMap = new Map<string, string>()
    for (const row of summaryRows) {
      const sid = String(row.snapshot_id)
      if (seen.has(sid)) continue
      seen.add(sid)
      const parsed = JSON.parse(String(row.summary_json)) as unknown
      const markdown = Array.isArray(parsed)
        ? parsed.map((item: unknown) => `- ${String(item)}`).join("\n")
        : String(parsed)
      summaryMap.set(sid, markdown)
    }

    const tagPlaceholders = feedItemIds.map(() => "?").join(",")
    const tagRows = feedItemIds.length
      ? (this.database
          .prepare(
            `SELECT at.feed_item_id AS feed_item_id, t.name AS name
             FROM article_tags at JOIN tags t ON t.id = at.tag_id
             WHERE at.owner_id = ? AND at.feed_item_id IN (${tagPlaceholders})
             ORDER BY t.name`
          )
          .all(ownerId, ...feedItemIds) as Record<string, unknown>[])
      : []
    const tagsMap = new Map<string, string[]>()
    for (const row of tagRows) {
      const feedItemId = String(row.feed_item_id)
      const list = tagsMap.get(feedItemId) ?? []
      const name = String(row.name)
      if (!list.includes(name)) list.push(name)
      tagsMap.set(feedItemId, list)
    }

    return rows.map((row) => {
      const relevance = relevanceMap.get(row.id)
      const summary = row.snapshotId
        ? summaryMap.get(row.snapshotId)
        : undefined
      return {
        ...row,
        ...(relevance
          ? {
              relevanceScore: relevance.score,
              relevanceReason: relevance.reason,
            }
          : {}),
        ...(summary ? { aiSummary: summary } : {}),
        tags: tagsMap.get(row.id) ?? [],
      }
    })
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
    readonly articleIds?: readonly string[]
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
      const insertArticle = this.database.prepare(
        `INSERT INTO episode_job_articles (job_id, feed_item_id, position)
         VALUES (?, ?, ?)`
      )
      input.articleIds?.forEach((articleId, index) =>
        insertArticle.run(jobId, articleId, index)
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
      .map((row) =>
        toJob(
          row,
          this.listJobArticleIds(String((row as Record<string, unknown>).id))
        )
      )
  }

  getJob(ownerId: string, jobId: string): JobDto | undefined {
    const row = this.database
      .prepare("SELECT * FROM episode_jobs WHERE owner_id = ? AND id = ?")
      .get(ownerId, jobId)
    return row
      ? toJob(
          row,
          this.listJobArticleIds(String((row as Record<string, unknown>).id))
        )
      : undefined
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
      this.recordJobEvent(
        jobId,
        "job.canceled",
        this.currentAttempt(jobId),
        undefined,
        now
      )
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
      // 再試行で生成対象が変わってはいけないので、選択記事も同じく引き継ぐ。
      this.database
        .prepare(
          `INSERT INTO episode_job_articles (job_id, feed_item_id, position)
           SELECT ?, feed_item_id, position
           FROM episode_job_articles WHERE job_id = ?`
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
    this.transaction(() => {
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
      this.recordJobEvent(
        jobId,
        "job.retrying",
        this.currentAttempt(jobId),
        undefined,
        new Date().toISOString(),
        {
          code: failure.code,
          message: failure.message,
          nextAttemptAt: nextAttemptAt.toISOString(),
        }
      )
    })
  }

  failJob(jobId: string, leaseToken: string, failure: JobFailureDto): void {
    this.transaction(() => {
      const finishedAt = new Date().toISOString()
      const result = this.database
        .prepare(
          `UPDATE episode_jobs SET status = 'failed', finished_at = ?,
           failure_code = ?, failure_message = ?, failure_retryable = ?,
           lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
           WHERE id = ? AND status = 'running' AND lease_token = ?`
        )
        .run(
          finishedAt,
          failure.code,
          failure.message,
          failure.retryable ? 1 : 0,
          jobId,
          leaseToken
        )
      if (result.changes !== 1) throw new LeaseLostError(jobId)
      this.recordJobEvent(
        jobId,
        "job.failed",
        this.currentAttempt(jobId),
        undefined,
        finishedAt,
        {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        }
      )
    })
  }

  private currentAttempt(jobId: string): number {
    const row = this.database
      .prepare("SELECT attempt FROM episode_jobs WHERE id = ?")
      .get(jobId) as Record<string, unknown> | undefined
    return row ? Number(row.attempt) : 0
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
      this.recordJobEvent(
        input.jobId,
        "job.succeeded",
        this.currentAttempt(input.jobId),
        undefined,
        createdAt,
        {
          episodeId,
          title: input.title,
          sourceCount: input.sources.length,
        }
      )
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
    // sequence は SSE の Last-Event-ID カーソル。採番と挿入が同じ
    // トランザクションに乗っている必要があるため、ここで一括して行う。
    this.database
      .prepare(
        `INSERT INTO episode_job_events
         (id, job_id, event_type, attempt, stage, payload_json, created_at,
          sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(sequence), 0) + 1
            FROM episode_job_events WHERE job_id = ?))`
      )
      .run(
        randomUUID(),
        jobId,
        eventType,
        attempt,
        stage ?? null,
        JSON.stringify(payload),
        createdAt,
        jobId
      )
  }

  /**
   * ワーカー側から任意のパイプラインイベントを追記する。進捗ストリームの
   * 発生源であり、`recordJobEvent` と同じ sequence 空間を共有する。
   */
  appendJobEvent(input: {
    readonly jobId: string
    readonly eventType: string
    /** 省略時はジョブの現在の試行回数を使う。 */
    readonly attempt?: number
    readonly stage?: JobStage
    readonly payload?: Readonly<Record<string, unknown>>
  }): void {
    this.recordJobEvent(
      input.jobId,
      input.eventType,
      input.attempt ?? this.currentAttempt(input.jobId),
      input.stage,
      new Date().toISOString(),
      input.payload ?? {}
    )
  }

  /**
   * `sequence` より後のイベントを古い順に返す。SSE の tail とリプレイの両方が
   * この 1 つのクエリを使う。
   */
  listJobEventsAfter(input: {
    readonly ownerId: string
    readonly jobId: string
    readonly afterSequence: number
    readonly limit?: number
  }): readonly JobEventDto[] {
    return this.database
      .prepare(
        `SELECT e.sequence, e.event_type, e.attempt, e.stage, e.payload_json,
                e.created_at
         FROM episode_job_events e
         JOIN episode_jobs j ON j.id = e.job_id
         WHERE e.job_id = ? AND j.owner_id = ? AND e.sequence > ?
         ORDER BY e.sequence
         LIMIT ?`
      )
      .all(input.jobId, input.ownerId, input.afterSequence, input.limit ?? 500)
      .map((row) => {
        const record = row as Record<string, unknown>
        return {
          sequence: Number(record.sequence),
          eventType: String(record.event_type),
          attempt: Number(record.attempt),
          ...(record.stage ? { stage: String(record.stage) as JobStage } : {}),
          payload: JSON.parse(String(record.payload_json)) as Readonly<
            Record<string, unknown>
          >,
          createdAt: String(record.created_at),
        }
      })
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

  // listArticlesと同じSELECT/FROMを共有する単発取得用（getArticleが使う）。
  private articleRows(ownerId: string, articleId?: string, limit = 100) {
    return this.database
      .prepare(
        `SELECT ${ARTICLE_SELECT}
         ${ARTICLE_FROM}
         WHERE sub.enabled = 1 AND (? IS NULL OR i.id = ?)
         ORDER BY ${ARTICLE_SORT_KEY} DESC, i.id DESC
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

// published_at優先、無ければdiscovered_atで並べる。既存インデックス
// idx_feed_items_feed_published (feed_id, published_at DESC, discovered_at DESC) と列順を揃える。
const ARTICLE_SORT_KEY = "COALESCE(i.published_at, i.discovered_at)"

/**
 * 「生成対象として選べる記事」の条件。
 * filterSelectableArticleIds / listAgentArticles / listArticles(archiveStatus=succeeded)
 * の3箇所で使い回す単一の真実源。これがズレるとUIで選べるのにAPIが弾く不整合が起きる。
 */
const SELECTABLE_ITEM_PREDICATE =
  "i.archive_status = 'succeeded' AND i.latest_snapshot_id IS NOT NULL"

// あるスナップショットが (owner配下の) いずれかのエピソードで使われたかどうか。
// sub.owner_id は既にARTICLE_FROMのJOIN条件で束縛済みの列なので、追加のバインド引数は不要。
const USED_IN_EPISODE_EXISTS = `EXISTS (
    SELECT 1 FROM episode_sources es
    JOIN episodes e ON e.id = es.episode_id
    WHERE es.snapshot_id = i.latest_snapshot_id AND e.owner_id = sub.owner_id
  )`

const ARTICLE_SELECT = `i.id, i.feed_id, f.name AS source_name, i.title, i.url,
    i.published_at, i.summary, i.discovered_at, i.archive_status,
    i.latest_snapshot_id, COALESCE(s.read, 0) AS read,
    COALESCE(s.saved, 0) AS saved, COALESCE(s.read_later, 0) AS read_later,
    COALESCE(s.hidden, 0) AS hidden, s.hidden_at AS hidden_at,
    ${USED_IN_EPISODE_EXISTS} AS used_in_episode,
    ${ARTICLE_SORT_KEY} AS sort_key`

const ARTICLE_FROM = `FROM feed_items i
    JOIN feed_catalog f ON f.id = i.feed_id
    JOIN feed_subscriptions sub
      ON sub.feed_id = i.feed_id AND sub.owner_id = ?
    LEFT JOIN article_user_states s
      ON s.feed_item_id = i.id AND s.owner_id = ?`

interface ArticleSortColumn {
  readonly expr: string
  readonly alias: string
  readonly direction: "ASC" | "DESC"
}

// ソートモードごとのORDER BY列。末尾に必ずi.id（一意）を含めることで
// keysetページネーションの境界で重複・欠落が起きないようにする。
function articleSortColumns(
  sort: ArticleListSort
): readonly ArticleSortColumn[] {
  if (sort === "oldest") {
    return [
      { expr: ARTICLE_SORT_KEY, alias: "sort_key", direction: "ASC" },
      { expr: "i.id", alias: "id", direction: "ASC" },
    ]
  }
  if (sort === "source") {
    return [
      { expr: "f.name", alias: "source_name", direction: "ASC" },
      { expr: ARTICLE_SORT_KEY, alias: "sort_key", direction: "DESC" },
      { expr: "i.id", alias: "id", direction: "DESC" },
    ]
  }
  if (sort === "relevance") {
    // 未処理（スコア無し）記事は常に末尾へ回す。CASE式が'0'(スコア有)/'1'(スコア無)で
    // 先に並べ、スコア有の中では降順、同点はsort_key/idで安定させる。
    // keysetカーソルの比較はTEXT同士でしか値クラスの一致が保証できない
    // （SQLiteはINTEGERとTEXTの比較で値クラス優先の順序になるため）ので、
    // 数値列はここで固定長ゼロ埋めのTEXTへ変換して他の列と揃える。
    return [
      {
        expr: "CASE WHEN rel.score IS NULL THEN '1' ELSE '0' END",
        alias: "score_missing",
        direction: "ASC",
      },
      {
        expr: "printf('%05d', COALESCE(rel.score, -1) + 1)",
        alias: "score",
        direction: "DESC",
      },
      { expr: ARTICLE_SORT_KEY, alias: "sort_key", direction: "DESC" },
      { expr: "i.id", alias: "id", direction: "DESC" },
    ]
  }
  return [
    { expr: ARTICLE_SORT_KEY, alias: "sort_key", direction: "DESC" },
    { expr: "i.id", alias: "id", direction: "DESC" },
  ]
}

function clampArticleLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50
  return Math.min(100, Math.max(1, Math.trunc(limit)))
}

// 日次バッチの処理件数カウンタ(ai_enrich_daily_progress)のキー。workerと揃える。
function toLocalDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function encodeArticleCursor(values: readonly string[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url")
}

function decodeArticleCursor(cursor: string): readonly string[] | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as unknown
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function encodeCursorFor(
  columns: readonly ArticleSortColumn[],
  row: Record<string, unknown> | undefined
): string | undefined {
  if (!row) return undefined
  return encodeArticleCursor(columns.map((column) => String(row[column.alias])))
}

// keyset述語: (c1, c2, ..., cn) の辞書式比較をOR連鎖で表現する。
// SQLiteの行値比較に依存しないため全バージョンで安全に動く。
function keysetPredicate(
  columns: readonly ArticleSortColumn[],
  cursorValues: readonly string[]
): { readonly sql: string; readonly params: readonly string[] } {
  const clauses: string[] = []
  const params: string[] = []
  for (let i = 0; i < columns.length; i++) {
    const eqParts: string[] = []
    for (let j = 0; j < i; j++) {
      eqParts.push(`${columns[j]!.expr} = ?`)
      params.push(cursorValues[j]!)
    }
    const cmp = columns[i]!.direction === "DESC" ? "<" : ">"
    clauses.push(
      `(${[...eqParts, `${columns[i]!.expr} ${cmp} ?`].join(" AND ")})`
    )
    params.push(cursorValues[i]!)
  }
  return { sql: `(${clauses.join(" OR ")})`, params }
}

// FTS5(trigram)ベースの検索述語。ソース名(f.name)はfeed_items_ftsに無いため、
// 常にLIKEで別枠に足す（フィード数は少なくコストは無視できる）。
// trigramは3文字未満のクエリにマッチしないため、短いクエリはLIKEへフォールバックする。
function articleSearchPredicate(q: string | undefined): {
  readonly sql: string
  readonly params: readonly string[]
} {
  if (!q) return { sql: "1=1", params: [] }
  const trimmed = q.trim()
  if (!trimmed) return { sql: "1=1", params: [] }
  const pattern = `%${escapeLikePattern(trimmed)}%`
  const sourcePredicate = "f.name LIKE ? ESCAPE '\\'"

  if ([...trimmed].length < FTS_TRIGRAM_MIN_LENGTH) {
    return {
      sql: `(i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\' OR ${sourcePredicate})`,
      params: [pattern, pattern, pattern],
    }
  }
  return {
    sql: `(i.rowid IN (SELECT rowid FROM feed_items_fts WHERE feed_items_fts MATCH ?) OR ${sourcePredicate})`,
    params: [toFtsLiteralQuery(trimmed), pattern],
  }
}

// trigramトークナイザが有効に働く最小文字数（コードポイント単位）。
const FTS_TRIGRAM_MIN_LENGTH = 3

// ユーザー入力をFTS5クエリ構文として解釈させないため、常に二重引用符で
// くくったリテラルフレーズにする。二重引用符自体は二重化してエスケープする。
function toFtsLiteralQuery(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function articleStatePredicate(state: ArticleListState | undefined): string {
  if (state === "unread") return "COALESCE(s.read, 0) = 0"
  if (state === "saved") return "COALESCE(s.saved, 0) = 1"
  if (state === "later") return "COALESCE(s.read_later, 0) = 1"
  return "1=1"
}

// 既定ではhiddenな記事を全stateから除外する。includeHidden指定時のみ含める。
function articleHiddenPredicate(includeHidden: boolean | undefined): string {
  return includeHidden ? "1=1" : "COALESCE(s.hidden, 0) = 0"
}

function articleFeedIdsPredicate(feedIds: readonly string[] | undefined): {
  readonly sql: string
  readonly params: readonly string[]
} {
  if (!feedIds || feedIds.length === 0) return { sql: "1=1", params: [] }
  return {
    sql: `i.feed_id IN (${feedIds.map(() => "?").join(",")})`,
    params: feedIds,
  }
}

// タグ絞り込み。複数指定時はOR（いずれか1つでも付いていれば一致）。
// article_tagsは1記事に複数行あり得るためJOINではなくEXISTSで絞り込む（重複行を防ぐ）。
function articleTagsPredicate(tagIds: readonly string[] | undefined): {
  readonly sql: string
  readonly params: readonly string[]
} {
  if (!tagIds || tagIds.length === 0) return { sql: "1=1", params: [] }
  return {
    sql: `EXISTS (
      SELECT 1 FROM article_tags at
      WHERE at.feed_item_id = i.id AND at.owner_id = sub.owner_id
        AND at.tag_id IN (${tagIds.map(() => "?").join(",")})
    )`,
    params: tagIds,
  }
}

// 期間絞り込み。ソート基準(ARTICLE_SORT_KEY = COALESCE(published_at, discovered_at))と
// 同じ列を対象にすることで、期間で絞り込んでもページネーションの境界がずれないようにする。
// after/beforeとも境界値を含む閉区間として扱う（APIのrefineで after<=before を保証済み）。
function articlePublishedRangePredicate(
  after: string | undefined,
  before: string | undefined
): { readonly sql: string; readonly params: readonly string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (after !== undefined) {
    clauses.push(`${ARTICLE_SORT_KEY} >= ?`)
    params.push(after)
  }
  if (before !== undefined) {
    clauses.push(`${ARTICLE_SORT_KEY} <= ?`)
    params.push(before)
  }
  if (clauses.length === 0) return { sql: "1=1", params: [] }
  return { sql: `(${clauses.join(" AND ")})`, params }
}

// アーカイブ状態での絞り込み。複数指定時はOR相当（IN句）。
function articleArchiveStatusPredicate(
  statuses: readonly ArticleDto["archiveStatus"][] | undefined
): { readonly sql: string; readonly params: readonly string[] } {
  if (!statuses || statuses.length === 0) return { sql: "1=1", params: [] }
  const parts: string[] = []
  const params: string[] = []
  const nonSelectable = statuses.filter((s) => s !== "succeeded")
  if (statuses.includes("succeeded")) {
    // SELECTABLE_ITEM_PREDICATE をそのまま使うことで、
    // filterSelectableArticleIds / listAgentArticles との一貫性を構造的に保証する。
    parts.push(`(${SELECTABLE_ITEM_PREDICATE})`)
  }
  if (nonSelectable.length > 0) {
    parts.push(
      `i.archive_status IN (${nonSelectable.map(() => "?").join(",")})`
    )
    params.push(...nonSelectable)
  }
  return {
    sql: parts.join(" OR "),
    params,
  }
}

function articleUsedInEpisodePredicate(usedInEpisode: boolean | undefined): {
  readonly sql: string
  readonly params: readonly string[]
} {
  if (usedInEpisode === undefined) return { sql: "1=1", params: [] }
  return {
    sql: usedInEpisode
      ? USED_IN_EPISODE_EXISTS
      : `NOT ${USED_IN_EPISODE_EXISTS}`,
    params: [],
  }
}

// PATCH/bulk-stateで未指定のフラグは既存値を維持する。
function resolveBooleanField(
  explicit: boolean | undefined,
  current: unknown
): boolean {
  return explicit ?? Boolean(current)
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
    readLater: Boolean(value.read_later),
    hidden: Boolean(value.hidden),
    ...(value.hidden_at ? { hiddenAt: String(value.hidden_at) } : {}),
    usedInEpisode: Boolean(value.used_in_episode),
    tags: [],
  }
}

function toTag(row: Record<string, unknown>): TagDto {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
  }
}

function toTagSuggestion(row: Record<string, unknown>): TagSuggestionDto {
  return {
    name: String(row.name),
    occurrences: Number(row.occurrences),
    lastSeenAt: String(row.last_seen_at),
  }
}

function toReadingDictionaryEntry(
  row: Record<string, unknown>,
): ReadingDictionaryDto {
  return {
    id: String(row.id),
    surface: String(row.surface),
    reading: String(row.reading),
    accentType: Number(row.accent_type),
    wordUuid: row.word_uuid ? String(row.word_uuid) : null,
    source: String(row.source) as "manual" | "ai_auto",
    episodeJobId: row.episode_job_id ? String(row.episode_job_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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

function toJob(row: unknown, articleIds: readonly string[] = []): JobDto {
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
    articleIds,
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
