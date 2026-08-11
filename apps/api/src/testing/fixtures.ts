import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach } from "vitest"
import { LocalStore } from "@news-podcast/adapters/db/local"

/**
 * テスト用の一時SQLite LocalStoreを発行するファクトリを作る。
 * 呼び出したテストファイルの afterEach で、発行したディレクトリをまとめて削除する。
 * 各テストは使い終わったストアで store.close() を呼ぶこと（WALのflushを保証するため）。
 */
export function useTemporaryStore(
  prefix = "news-podcast-api-"
): () => LocalStore {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  return () => {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    directories.push(directory)
    return new LocalStore(join(directory, "app.sqlite"))
  }
}

/** レスポンスボディをJSONとして読む、型注釈のためだけの小さなヘルパ。 */
export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/**
 * アーカイブ完了済みの記事を1件作る。AI補助（要約/関連度スコア）関連のテストは
 * アーカイブ済み記事を前提とするため、enrich-queue・articles/enrich系のテストで共有する。
 */
export function seedArchivedArticle(
  store: LocalStore,
  ownerId: string,
  externalId: string
): string {
  const { feed } = store.registerFeed({
    ownerId,
    name: `feed-${externalId}`,
    siteUrl: `https://${externalId}.example.com`,
    feedUrl: `https://${externalId}.example.com/feed.xml`,
  })
  store.upsertFeedItems(feed.id, [
    {
      externalId,
      title: `title-${externalId}`,
      url: `https://${externalId}.example.com/article`,
    },
  ])
  const candidate = store.leaseArchiveCandidate()!
  store.completeArchive({
    articleId: candidate.id,
    snapshotId: `${externalId}-snapshot`,
    sourceUrl: candidate.url,
    title: candidate.title,
    contentHash: `${externalId}-hash`,
    rawKey: `${externalId}/raw.html`,
    replayKey: `${externalId}/replay.html`,
    markdownKey: `${externalId}/markdown.md`,
    byteLength: 100,
    assets: [],
  })
  return candidate.id
}
