import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"

import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  CompletionSaveResult,
  CompletionStoreFailure,
  EpisodeCompletionPorts,
} from "../../application/completion-ports.js"
import type {
  CompletedEpisodeReader,
  EpisodeLibraryStorageFailure,
} from "../../application/ports.js"
import type { InboxMessageId } from "../../domain/episode-completion.js"
import type {
  CompletedEpisode,
  EpisodeId,
  OwnerId,
  UtcInstant,
} from "../../domain/episode.js"
import { parseCompletedEpisode } from "../../adapters/parse-stored-episode.js"

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS episode_completion_inbox (
    message_id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    received_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    script TEXT NOT NULL,
    audio_object_key TEXT NOT NULL,
    audio_byte_length INTEGER NOT NULL CHECK (audio_byte_length > 0),
    audio_content_type TEXT NOT NULL CHECK (audio_content_type IN ('audio/wav', 'audio/mpeg')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS episodes_owner_created_idx
    ON episodes(owner_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS episode_sources (
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('rss', 'web')),
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    snapshot_id TEXT,
    PRIMARY KEY (episode_id, position),
    CHECK (
      (source_kind = 'rss' AND snapshot_id IS NOT NULL) OR
      (source_kind = 'web' AND snapshot_id IS NULL AND published_at IS NULL)
    )
  ) STRICT;
`

export type SqliteEpisodeRepository = CompletedEpisodeReader &
  Pick<EpisodeCompletionPorts, "saveOnce"> & {
    readonly close: Effect.Effect<void>
  }

export const makeSqliteEpisodeRepository = (
  databasePath: string
): SqliteEpisodeRepository => {
  const database = new DatabaseSync(databasePath)
  database.exec(schema)

  const saveOnce = (
    messageId: InboxMessageId,
    episode: CompletedEpisode,
    receivedAt: UtcInstant
  ): Effect.Effect<CompletionSaveResult, CompletionStoreFailure> =>
    Effect.try({
      try: () => saveTransaction(database, messageId, episode, receivedAt),
      catch: () =>
        deepFreeze({
          _tag: "CompletionStoreFailure" as const,
          operation: "save" as const,
        }),
    })

  const listByOwner = (
    ownerId: OwnerId
  ): Effect.Effect<readonly CompletedEpisode[], EpisodeLibraryStorageFailure> =>
    selectEpisodeRows(database, ownerId).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          parseDatabaseEpisode(database, row as EpisodeRow)
        )
      ),
      Effect.map(
        (episodes) => deepFreeze(episodes) as readonly CompletedEpisode[]
      ),
      Effect.mapError(() => storageFailure("list"))
    )

  const findByOwner = (
    ownerId: OwnerId,
    episodeId: EpisodeId
  ): Effect.Effect<
    CompletedEpisode | undefined,
    EpisodeLibraryStorageFailure
  > =>
    selectEpisodeRow(database, ownerId, episodeId).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.succeed(undefined)
          : parseDatabaseEpisode(database, row as EpisodeRow)
      ),
      Effect.mapError(() => storageFailure("find"))
    )

  return deepFreeze({
    saveOnce,
    listByOwner,
    findByOwner,
    close: Effect.sync(() => database.close()),
  })
}

const saveTransaction = (
  database: DatabaseSync,
  messageId: InboxMessageId,
  episode: CompletedEpisode,
  receivedAt: UtcInstant
): CompletionSaveResult => {
  database.exec("BEGIN IMMEDIATE")
  try {
    const payloadHash = episodeFingerprint(episode)
    const inbox = database
      .prepare(
        `INSERT INTO episode_completion_inbox
         (message_id, episode_id, payload_hash, received_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`
      )
      .run(messageId, episode.id, payloadHash, receivedAt)
    if (inbox.changes === 0) {
      const previous = database
        .prepare(
          `SELECT episode_id, payload_hash
           FROM episode_completion_inbox WHERE message_id = ?`
        )
        .get(messageId)
      if (
        previous?.episode_id !== episode.id ||
        previous.payload_hash !== payloadHash
      ) {
        throw new Error("Inbox message ID was reused with different content")
      }
      database.exec("COMMIT")
      return "Duplicate"
    }

    database
      .prepare(
        `INSERT INTO episodes
         (id, owner_id, title, script, audio_object_key, audio_byte_length,
          audio_content_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        episode.id,
        episode.ownerId,
        episode.title,
        episode.script,
        episode.audio.objectKey,
        episode.audio.byteLength,
        episode.audio.contentType,
        episode.createdAt
      )
    const insertSource = database.prepare(
      `INSERT INTO episode_sources
       (episode_id, position, source_kind, url, title, published_at, snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [position, source] of episode.sources.entries()) {
      insertSource.run(
        episode.id,
        position,
        source._tag === "RssSource" ? "rss" : "web",
        source.url,
        source.title,
        source._tag === "RssSource" ? (source.publishedAt ?? null) : null,
        source._tag === "RssSource" ? source.snapshotId : null
      )
    }
    database.exec("COMMIT")
    return "Stored"
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

const episodeFingerprint = (episode: CompletedEpisode): string =>
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

type EpisodeRow = Readonly<Record<string, string | number | bigint | null>>

const selectEpisodeRows = (database: DatabaseSync, ownerId: OwnerId) =>
  Effect.try(() =>
    database
      .prepare(
        `SELECT id, owner_id, title, script, audio_object_key,
                audio_byte_length, audio_content_type, created_at
         FROM episodes
         WHERE owner_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(ownerId)
  )

const selectEpisodeRow = (
  database: DatabaseSync,
  ownerId: OwnerId,
  episodeId: EpisodeId
) =>
  Effect.try(() =>
    database
      .prepare(
        `SELECT id, owner_id, title, script, audio_object_key,
                audio_byte_length, audio_content_type, created_at
         FROM episodes
         WHERE owner_id = ? AND id = ?`
      )
      .get(ownerId, episodeId)
  )

const parseDatabaseEpisode = (database: DatabaseSync, row: EpisodeRow) => {
  const sources = database
    .prepare(
      `SELECT source_kind, url, title, published_at, snapshot_id
       FROM episode_sources WHERE episode_id = ? ORDER BY position`
    )
    .all(row.id as string)
    .map((source) => ({
      sourceKind: source.source_kind,
      url: source.url,
      title: source.title,
      ...(source.published_at === null
        ? {}
        : { publishedAt: source.published_at }),
      ...(source.snapshot_id === null
        ? {}
        : { snapshotId: source.snapshot_id }),
    }))
  return parseCompletedEpisode({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    script: row.script,
    audioObjectKey: row.audio_object_key,
    audioByteLength: row.audio_byte_length,
    audioContentType: row.audio_content_type,
    createdAt: row.created_at,
    sources,
  })
}

const storageFailure = (
  operation: EpisodeLibraryStorageFailure["operation"]
): EpisodeLibraryStorageFailure =>
  deepFreeze({ _tag: "EpisodeLibraryStorageFailure", operation })
