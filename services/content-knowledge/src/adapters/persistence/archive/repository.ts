import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  ArticleArchivedV1Schema,
  subjects,
  type MessageId,
} from "@news-podcast/protocols"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { articleSnapshots, contentOutbox } from "../../../../drizzle/schema.js"
import type {
  ArchiveArticlePorts,
  ArchiveCommit,
  ArchiveLookup,
  ArchiveStoreError,
} from "../../../application/ports/archive.js"
import { ArticleSnapshotSchema } from "../../../domain/article.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import type {
  ArticleArchivedWireEnvelope,
  OutboxStore,
} from "../../messaging/outbox.js"
import type { JsonInterop } from "../json-interop.js"
import { makeOutboxStore } from "./outbox.js"

const SnapshotRowSchema = Schema.Struct({ snapshotJson: Schema.String })
const parseSnapshotRow = parse(SnapshotRowSchema)

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

export type ArchiveStore = Pick<ArchiveArticlePorts, "lookup" | "commit"> &
  OutboxStore

export const createArchiveStore = (
  database: ContentKnowledgeDatabase,
  newMessageId: () => MessageId,
  jsonInterop: JsonInterop
): Effect.Effect<ArchiveStore, ArchiveStoreError> =>
  Effect.sync(() => {
    const selectSnapshotJson = (tx: QueryRunner, archiveRequestId: string) =>
      tx
        .select({ snapshotJson: articleSnapshots.snapshotJson })
        .from(articleSnapshots)
        .where(eq(articleSnapshots.archiveRequestId, archiveRequestId))
        .get()

    const lookup: ArchiveArticlePorts["lookup"] = (archiveRequestId) =>
      Effect.try({
        try: () => selectSnapshotJson(database, archiveRequestId),
        catch: (error) => archiveStoreError("Lookup", error),
      }).pipe(
        Effect.flatMap(
          (row): Effect.Effect<ArchiveLookup, ArchiveStoreError> =>
            row === undefined
              ? Effect.succeed(deepFreeze({ _tag: "NotArchived" as const }))
              : parseSnapshotRow(row).pipe(
                  Effect.mapError(() => archiveStoreError("Lookup")),
                  Effect.flatMap(({ snapshotJson }) =>
                    parseSnapshotJson(snapshotJson, "Lookup", jsonInterop)
                  ),
                  Effect.map((snapshot) =>
                    deepFreeze({ _tag: "Archived" as const, snapshot })
                  )
                )
        )
      )

    /** スナップショットとアウトボックスの記録は、ひとつのトランザクションに収める。 */
    const commit: ArchiveArticlePorts["commit"] = (input) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            const existing = selectSnapshotJson(
              tx,
              input.snapshot.archiveRequestId
            )
            if (existing !== undefined) {
              return deepFreeze({ _tag: "Existing" as const, row: existing })
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

            tx.insert(articleSnapshots)
              .values({
                archiveRequestId: input.snapshot.archiveRequestId,
                snapshotId: input.snapshot.snapshotId,
                // 記事一覧の結合キー。以前はJSONから式で取り出していた。
                articleId: input.snapshot.articleId,
                snapshotJson: jsonInterop.stringify(input.snapshot),
                capturedAt: input.snapshot.capturedAt,
              })
              .run()

            tx.insert(contentOutbox)
              .values({
                messageId,
                archiveRequestId: input.snapshot.archiveRequestId,
                subject: subjects.content.articleArchived,
                envelopeJson: jsonInterop.stringify(envelope),
                createdAt: input.snapshot.capturedAt,
              })
              .run()

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
                  Effect.flatMap(({ snapshotJson }) =>
                    parseSnapshotJson(snapshotJson, "Commit", jsonInterop)
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

    return deepFreeze({
      lookup,
      commit,
      ...makeOutboxStore(database, jsonInterop),
    })
  })
