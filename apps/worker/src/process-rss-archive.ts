import { ArticleArchiver } from "@news-podcast/adapters/archive"
import type { LocalStore } from "@news-podcast/adapters/db/local"
import { createSafeFetcher } from "@news-podcast/adapters/http/safe"
import { RssFeedReader } from "@news-podcast/adapters/rss"
import type { ObjectStore } from "@news-podcast/application"
import {
  noopObservability,
  type Observability,
} from "@news-podcast/observability"

export class RssArchiveWorker {
  private readonly feeds = new RssFeedReader(createSafeFetcher())
  private readonly archiver: ArticleArchiver

  constructor(
    private readonly store: LocalStore,
    objects: ObjectStore,
    private readonly observability: Observability = noopObservability
  ) {
    this.archiver = new ArticleArchiver(objects)
  }

  async runOnce(now = new Date()): Promise<void> {
    const feed = this.store.listFeedsDue(now, 1)[0]
    if (feed) await this.syncFeed(feed)
    const article = this.store.leaseArchiveCandidate()
    if (article) await this.archiveArticle(article.id, article.url)
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
