import { ArticleArchiver } from "@news-podcast/adapters/archive"
import type { ArchiveLimits } from "@news-podcast/adapters/config"
import type { LocalStore } from "@news-podcast/adapters/db/local"
import { createSafeFetcher } from "@news-podcast/adapters/http/safe"
import { RssFeedReader } from "@news-podcast/adapters/rss"
import type { ObjectStore } from "@news-podcast/application"
import {
  noopObservability,
  type Observability,
} from "@news-podcast/observability"

// 1tickあたりバックフィルする記事本文の件数。archiveArticleを塞がない程度に小さく保つ。
const SEARCH_BODY_BACKFILL_BATCH_SIZE = 5

export class RssArchiveWorker {
  private readonly feeds = new RssFeedReader(createSafeFetcher())
  private readonly archiver: ArticleArchiver

  constructor(
    private readonly store: LocalStore,
    private readonly objects: ObjectStore,
    private readonly observability: Observability = noopObservability,
    limits?: ArchiveLimits
  ) {
    this.archiver = new ArticleArchiver(objects, fetch, limits)
  }

  async runOnce(now = new Date()): Promise<void> {
    const feed = this.store.listFeedsDue(now, 1)[0]
    if (feed) await this.syncFeed(feed)
    const article = this.store.leaseArchiveCandidate()
    if (article) await this.archiveArticle(article.id, article.url)
    await this.backfillSearchBody(SEARCH_BODY_BACKFILL_BATCH_SIZE)
  }

  // 既にアーカイブ済みだがFTS索引にbodyが未投入の記事をN件処理する。
  // アーカイブ成功時の即時投入で拾えなかった過去分（機能追加前のデータなど）を埋める。
  // 戻り値は実際に処理した件数（0なら残作業なし）。
  async backfillSearchBody(limit: number): Promise<number> {
    const pending = this.store.listArticlesPendingBodyIndex(limit)
    let indexed = 0
    for (const article of pending) {
      if (await this.indexArticleBody(article.id, article.markdownKey)) {
        indexed += 1
      }
    }
    return indexed
  }

  private async indexArticleBody(
    articleId: string,
    markdownKey: string
  ): Promise<boolean> {
    try {
      const object = await this.objects.get(markdownKey)
      if (!object) {
        this.observability.log({
          name: "article.search_body.index_failed",
          level: "warn",
          error: new Error("Archived markdown object is unavailable"),
        })
        return false
      }
      this.store.setArticleSearchBody(
        articleId,
        new TextDecoder().decode(object.body)
      )
      return true
    } catch (error) {
      // 索引投入の失敗はアーカイブ自体の成否に影響させない。次回のバックフィルで再試行される。
      this.observability.log({
        name: "article.search_body.index_failed",
        level: "warn",
        error,
      })
      return false
    }
  }

  private async syncFeed(feed: {
    readonly id: string
    readonly name: string
    readonly feedUrl: string
  }): Promise<void> {
    try {
      const items = await this.feeds.read([feed])
      this.store.upsertFeedItems(
        feed.id,
        items.map((item) => ({
          externalId: item.externalId ?? item.url.href,
          title: item.title,
          url: item.url.href,
          ...(item.publishedAt
            ? { publishedAt: item.publishedAt.toISOString() }
            : {}),
          ...(item.description ? { summary: item.description } : {}),
        }))
      )
      this.store.markFeedSynced(feed.id)
      this.observability.log({ name: "rss.sync.succeeded" })
    } catch (error) {
      this.store.markFeedSynced(
        feed.id,
        error instanceof Error ? error.message : "RSS sync failed"
      )
      this.observability.log({ name: "rss.sync.failed", level: "warn", error })
    }
  }

  private async archiveArticle(articleId: string, url: string): Promise<void> {
    try {
      const archived = await this.archiver.archive(url)
      this.store.completeArchive({
        articleId,
        snapshotId: archived.snapshotId,
        sourceUrl: archived.sourceUrl,
        title: archived.title,
        contentHash: archived.contentHash,
        rawKey: archived.rawKey,
        replayKey: archived.replayKey,
        markdownKey: archived.markdownKey,
        byteLength: archived.byteLength,
        assets: archived.assets,
      })
      // アーカイブ直後に本文をFTS索引へ投入する。失敗してもアーカイブ自体は
      // 成功扱いのままとし、未投入分は次回のbackfillSearchBodyで拾う。
      await this.indexArticleBody(articleId, archived.markdownKey)
      this.observability.log({ name: "article.archive.succeeded" })
    } catch (error) {
      this.store.failArchive(
        articleId,
        error instanceof Error ? error.message : "Archive failed"
      )
      this.observability.log({
        name: "article.archive.failed",
        level: "warn",
        error,
      })
    }
  }
}
