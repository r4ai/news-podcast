import { deepFreeze, parse } from "@news-podcast/kernel"
import { MessageIdSchema, subjects } from "@news-podcast/protocols"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { contentOutbox } from "../../../../drizzle/schema.js"
import {
  parseArticleArchivedWireEnvelope,
  type OutboxStore,
  type OutboxStoreError,
  type PendingOutboxMessage,
} from "../../messaging/outbox.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type { JsonInterop } from "../json-interop.js"

const OutboxRowSchema = Schema.Struct({
  messageId: MessageIdSchema,
  subject: Schema.Literal(subjects.content.articleArchived),
  envelopeJson: Schema.String,
})
const parseOutboxRow = parse(OutboxRowSchema)

export const outboxStoreError = (
  operation: OutboxStoreError["operation"],
  reason: OutboxStoreError["reason"]
): OutboxStoreError =>
  deepFreeze({ _tag: "OutboxStoreFailed" as const, operation, reason })

export const makeOutboxStore = (
  database: ContentKnowledgeDatabase,
  jsonInterop: JsonInterop
): OutboxStore => {
  const listPending: OutboxStore["listPending"] = (limit) =>
    Effect.try({
      try: () =>
        database
          .select({
            messageId: contentOutbox.messageId,
            subject: contentOutbox.subject,
            envelopeJson: contentOutbox.envelopeJson,
          })
          .from(contentOutbox)
          .where(isNull(contentOutbox.publishedAt))
          .orderBy(asc(contentOutbox.createdAt), asc(contentOutbox.messageId))
          .limit(limit)
          .all(),
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
                try: () => jsonInterop.parse(parsedRow.envelopeJson),
                catch: () => outboxStoreError("ListPending", "CorruptRecord"),
              }).pipe(
                Effect.flatMap(parseArticleArchivedWireEnvelope),
                Effect.mapError(() =>
                  outboxStoreError("ListPending", "CorruptRecord")
                ),
                Effect.map((envelope): PendingOutboxMessage =>
                  deepFreeze({
                    messageId: parsedRow.messageId,
                    subject: parsedRow.subject,
                    envelope,
                    payload: parsedRow.envelopeJson,
                  })
                )
              )
            )
          )
        )
      ),
      Effect.map(deepFreeze)
    )

  /**
   * 既に公開済みの行は更新しない。中継が二重に走っても
   * 公開時刻が書き換わらないことを条件で担保する。
   */
  const markPublished: OutboxStore["markPublished"] = (
    messageId,
    publishedAt
  ) =>
    Effect.try({
      try: () =>
        database
          .update(contentOutbox)
          .set({ publishedAt })
          .where(
            and(
              eq(contentOutbox.messageId, messageId),
              isNull(contentOutbox.publishedAt)
            )
          )
          .run(),
      catch: () => outboxStoreError("MarkPublished", "Unavailable"),
    }).pipe(Effect.asVoid)

  return deepFreeze({ listPending, markPublished })
}
