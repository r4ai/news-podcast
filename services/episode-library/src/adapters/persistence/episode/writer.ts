import { createHash } from "node:crypto"

import { eq } from "drizzle-orm"

import { episodes, episodeSources } from "../../../../drizzle/schema.js"
import { episodeCompletionInbox } from "../../../../drizzle/schema.js"
import type { CompletionSaveResult } from "../../../application/ports/completion.js"
import type { InboxMessageId } from "../../../domain/episode-completion.js"
import type { CompletedEpisode, UtcInstant } from "../../../domain/episode.js"
import type { EpisodeLibraryDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

/**
 * 同一message_idの再送が同一内容であることの判定に使う。
 * 内容が異なる再利用は取り込まず、矛盾として扱う。
 */
export const episodeFingerprint = (episode: CompletedEpisode): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        id: episode.id,
        ownerId: episode.ownerId,
        title: episode.title,
        script: episode.script,
        audio: episode.audio,
        sources: episode.sources,
        createdAt: episode.createdAt,
      })
    )
    .digest("hex")

/** 受信簿への記録と集約の永続化は、ひとつのトランザクションに収める。 */
export const saveEpisodeOnce = (
  database: EpisodeLibraryDatabase,
  messageId: InboxMessageId,
  episode: CompletedEpisode,
  receivedAt: UtcInstant
): CompletionSaveResult =>
  database.transaction((tx): CompletionSaveResult => {
    const payloadHash = episodeFingerprint(episode)

    const inserted = tx
      .insert(episodeCompletionInbox)
      .values({
        messageId,
        episodeId: episode.id,
        payloadHash,
        receivedAt,
      })
      .onConflictDoNothing({ target: episodeCompletionInbox.messageId })
      .run()

    if (inserted.changes === 0) {
      const previous = tx
        .select({
          episodeId: episodeCompletionInbox.episodeId,
          payloadHash: episodeCompletionInbox.payloadHash,
        })
        .from(episodeCompletionInbox)
        .where(eq(episodeCompletionInbox.messageId, messageId))
        .get()

      if (
        previous?.episodeId !== episode.id ||
        previous.payloadHash !== payloadHash
      ) {
        throw new Error("Inbox message ID was reused with different content")
      }
      return "Duplicate"
    }

    tx.insert(episodes)
      .values({
        id: episode.id,
        ownerId: episode.ownerId,
        title: episode.title,
        script: episode.script,
        audioObjectKey: episode.audio.objectKey,
        audioByteLength: episode.audio.byteLength,
        audioContentType: episode.audio.contentType,
        createdAt: episode.createdAt,
      })
      .run()

    tx.insert(episodeSources)
      .values(
        episode.sources.map((source, position) => ({
          episodeId: episode.id,
          position,
          sourceKind:
            source._tag === "RssSource" ? ("rss" as const) : ("web" as const),
          url: source.url,
          title: source.title,
          articleId: source._tag === "RssSource" ? source.articleId : null,
          publishedAt:
            source._tag === "RssSource" ? (source.publishedAt ?? null) : null,
          snapshotId: source._tag === "RssSource" ? source.snapshotId : null,
        }))
      )
      .run()

    return "Stored"
  })
