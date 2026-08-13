import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  ArticleArchivedV1Schema,
  MessageIdSchema,
  subjects,
  type MessageId,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type {
  ArchiveArticlePorts,
  ArchiveCommit,
  ArchiveLookup,
  ArchiveStoreError,
} from "../application/ports.js"
import { ArticleSnapshotSchema } from "../domain/article.js"
import {
  parseArticleArchivedWireEnvelope,
  type ArticleArchivedWireEnvelope,
  type OutboxStore,
  type OutboxStoreError,
  type PendingOutboxMessage,
} from "./outbox.js"
import type { JsonInterop, SqlitePort } from "./sqlite-port.js"

const schema = `
CREATE TABLE IF NOT EXISTS article_snapshots (
  archive_request_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS content_outbox (
  message_id TEXT PRIMARY KEY,
  archive_request_id TEXT NOT NULL UNIQUE
    REFERENCES article_snapshots(archive_request_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS content_outbox_pending
  ON content_outbox(created_at, message_id)
  WHERE published_at IS NULL;
`

const SnapshotRowSchema = Schema.Struct({ snapshot_json: Schema.String })
const parseSnapshotRow = parse(SnapshotRowSchema)

const OutboxRowSchema = Schema.Struct({
  message_id: MessageIdSchema,
  subject: Schema.Literal(subjects.content.articleArchived),
  envelope_json: Schema.String,
})
const parseOutboxRow = parse(OutboxRowSchema)
const decodeArticleArchived = Schema.decodeUnknownSync(
  ArticleArchivedV1Schema,
  {
    errors: "all",
    onExcessProperty: "error",
  }
)

const archiveStoreError = (
  operation: ArchiveStoreError["operation"],
  error?: unknown
): ArchiveStoreError =>
  deepFreeze({
    _tag: "ArchiveStoreFailed" as const,
    operation,
    reason:
      error instanceof Error && /constraint|unique/i.test(error.message)
        ? ("Conflict" as const)
        : ("Unavailable" as const),
  })

const outboxStoreError = (
  operation: OutboxStoreError["operation"],
  reason: OutboxStoreError["reason"]
): OutboxStoreError =>
  deepFreeze({ _tag: "OutboxStoreFailed" as const, operation, reason })

const parseSnapshotJson = (
  input: string,
  operation: ArchiveStoreError["operation"],
  jsonInterop: JsonInterop
) =>
  Effect.try({
    try: () => jsonInterop.parse(input),
    catch: () => archiveStoreError(operation),
  }).pipe(
    Effect.flatMap((json) => parse(ArticleSnapshotSchema)(json)),
    Effect.mapError(() => archiveStoreError(operation))
  )

export type SqliteArchiveStore = Pick<
  ArchiveArticlePorts,
  "lookup" | "commit"
> &
  OutboxStore

export const createSqliteArchiveStore = (
  database: SqlitePort,
  newMessageId: () => MessageId,
  jsonInterop: JsonInterop
): Effect.Effect<SqliteArchiveStore, ArchiveStoreError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: (error) => archiveStoreError("Commit", error),
  }).pipe(
    Effect.map(() => {
      const lookup: ArchiveArticlePorts["lookup"] = (archiveRequestId) =>
        Effect.try({
          try: () =>
            database.get(
              "SELECT snapshot_json FROM article_snapshots WHERE archive_request_id = ?",
              [archiveRequestId]
            ),
          catch: (error) => archiveStoreError("Lookup", error),
        }).pipe(
          Effect.flatMap(
            (row): Effect.Effect<ArchiveLookup, ArchiveStoreError> => {
              if (row === undefined) {
                return Effect.succeed(
                  deepFreeze({ _tag: "NotArchived" as const })
                )
              }
              return parseSnapshotRow(row).pipe(
                Effect.mapError(() => archiveStoreError("Lookup")),
                Effect.flatMap(({ snapshot_json }) =>
                  parseSnapshotJson(snapshot_json, "Lookup", jsonInterop)
                ),
                Effect.map((snapshot) =>
                  deepFreeze({ _tag: "Archived" as const, snapshot })
                )
              )
            }
          )
        )

      const commit: ArchiveArticlePorts["commit"] = (input) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              const existing = database.get(
                "SELECT snapshot_json FROM article_snapshots WHERE archive_request_id = ?",
                [input.snapshot.archiveRequestId]
              )
              if (existing !== undefined) {
                return deepFreeze({
                  _tag: "Existing" as const,
                  row: existing,
                })
              }

              const messageId = newMessageId()
              const wireEvent = decodeArticleArchived(input.event)
              const envelope: ArticleArchivedWireEnvelope = deepFreeze({
                messageId,
                correlationId: input.context.correlationId,
                causationId: input.context.messageId,
                occurredAt: input.snapshot.capturedAt,
                producer: "content-knowledge",
                traceparent: input.context.traceparent,
                actor: input.context.actor,
                payload: wireEvent,
              })
              const snapshotJson = jsonInterop.stringify(input.snapshot)
              const envelopeJson = jsonInterop.stringify(envelope)

              database.run(
                `INSERT INTO article_snapshots
                  (archive_request_id, snapshot_id, snapshot_json, captured_at)
                 VALUES (?, ?, ?, ?)`,
                [
                  input.snapshot.archiveRequestId,
                  input.snapshot.snapshotId,
                  snapshotJson,
                  input.snapshot.capturedAt,
                ]
              )
              database.run(
                `INSERT INTO content_outbox
                  (message_id, archive_request_id, subject, envelope_json, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                  messageId,
                  input.snapshot.archiveRequestId,
                  subjects.content.articleArchived,
                  envelopeJson,
                  input.snapshot.capturedAt,
                ]
              )
              return deepFreeze({ _tag: "Inserted" as const })
            }),
          catch: (error) => archiveStoreError("Commit", error),
        }).pipe(
          Effect.flatMap(
            (result): Effect.Effect<ArchiveCommit, ArchiveStoreError> =>
              result._tag === "Inserted"
                ? Effect.succeed(deepFreeze({ _tag: "Committed" as const }))
                : parseSnapshotRow(result.row).pipe(
                    Effect.mapError(() => archiveStoreError("Commit")),
                    Effect.flatMap(({ snapshot_json }) =>
                      parseSnapshotJson(snapshot_json, "Commit", jsonInterop)
                    ),
                    Effect.map((snapshot) =>
                      deepFreeze({
                        _tag: "AlreadyCommitted" as const,
                        snapshot,
                      })
                    )
                  )
          )
        )

      const listPending: OutboxStore["listPending"] = (limit) =>
        Effect.try({
          try: () =>
            database.all(
              `SELECT message_id, subject, envelope_json
                 FROM content_outbox
                WHERE published_at IS NULL
                ORDER BY created_at, message_id
                LIMIT ?`,
              [limit]
            ),
          catch: () => outboxStoreError("ListPending", "Unavailable"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parseOutboxRow(row).pipe(
                Effect.mapError(() =>
                  outboxStoreError("ListPending", "CorruptRecord")
                ),
                Effect.flatMap((parsedRow) =>
                  Effect.try({
                    try: () => jsonInterop.parse(parsedRow.envelope_json),
                    catch: () =>
                      outboxStoreError("ListPending", "CorruptRecord"),
                  }).pipe(
                    Effect.flatMap(parseArticleArchivedWireEnvelope),
                    Effect.mapError(() =>
                      outboxStoreError("ListPending", "CorruptRecord")
                    ),
                    Effect.map((envelope): PendingOutboxMessage =>
                      deepFreeze({
                        messageId: parsedRow.message_id,
                        subject: parsedRow.subject,
                        envelope,
                        payload: parsedRow.envelope_json,
                      })
                    )
                  )
                )
              )
            )
          ),
          Effect.map(deepFreeze)
        )

      const markPublished: OutboxStore["markPublished"] = (
        messageId,
        publishedAt
      ) =>
        Effect.try({
          try: () => {
            database.run(
              `UPDATE content_outbox
                  SET published_at = ?
                WHERE message_id = ? AND published_at IS NULL`,
              [publishedAt, messageId]
            )
          },
          catch: () => outboxStoreError("MarkPublished", "Unavailable"),
        })

      return deepFreeze({ lookup, commit, listPending, markPublished })
    })
  )
