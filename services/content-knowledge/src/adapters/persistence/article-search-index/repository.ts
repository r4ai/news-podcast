import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleSearchIndexQueue,
  articleSearchShortGrams,
} from "../../../../drizzle/schema.js"
import type {
  ArticleSearchIndexFailureReason,
  ArticleSearchIndexRepository,
  ArticleSearchIndexStoreError,
} from "../../../application/article-search-index.js"
import { ObjectKeySchema } from "../../../domain/article.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

const FailureReasonSchema = Schema.Literals([
  "CorruptObject",
  "NotFound",
  "ResourceLimit",
  "Unavailable",
])
const PendingRowSchema = Schema.Struct({
  snapshotId: Schema.NonEmptyString,
  articleId: Schema.NonEmptyString,
  markdownKey: ObjectKeySchema,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastFailure: Schema.NullOr(FailureReasonSchema),
})
const CountRowSchema = Schema.Struct({
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
const SHORT_GRAM_INSERT_BATCH_SIZE = 500

const failure = (
  operation: ArticleSearchIndexStoreError["operation"],
  reason: ArticleSearchIndexStoreError["reason"] = "Unavailable"
): ArticleSearchIndexStoreError =>
  deepFreeze({ _tag: "ArticleSearchIndexStoreFailed", operation, reason })

/** Unique one- and two-codepoint grams used only below the FTS5 trigram floor. */
export const shortSearchGrams = (body: string): readonly string[] => {
  const characters = [...body]
  const grams = new Set<string>()
  for (let index = 0; index < characters.length; index += 1) {
    grams.add(characters[index]!)
    if (index + 1 < characters.length)
      grams.add(characters[index]! + characters[index + 1]!)
  }
  return [...grams]
}

export const createArticleSearchIndexRepository = (
  database: ContentKnowledgeDatabase
): ArticleSearchIndexRepository => ({
  listPending: (limit) =>
    Effect.try({
      try: () =>
        database
          .select({
            snapshotId: articleSearchIndexQueue.snapshotId,
            articleId: articleSearchIndexQueue.articleId,
            markdownKey: articleSearchIndexQueue.markdownKey,
            attempt: articleSearchIndexQueue.attempt,
            lastFailure: articleSearchIndexQueue.lastFailure,
          })
          .from(articleSearchIndexQueue)
          .orderBy(
            asc(articleSearchIndexQueue.attempt),
            asc(articleSearchIndexQueue.enqueuedAt),
            asc(articleSearchIndexQueue.snapshotId)
          )
          .limit(limit)
          .all(),
      catch: () => failure("ListPending"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, parse(PendingRowSchema)).pipe(
          Effect.mapError(() => failure("ListPending", "CorruptRecord"))
        )
      ),
      Effect.map(deepFreeze)
    ),
  index: ({ pending, body }) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          tx.run(
            sql`DELETE FROM article_search_fts WHERE snapshot_id = ${pending.snapshotId}`
          )
          tx.run(sql`INSERT INTO article_search_fts(snapshot_id, article_id, body)
                     VALUES (${pending.snapshotId}, ${pending.articleId}, ${body})`)
          tx.delete(articleSearchShortGrams)
            .where(eq(articleSearchShortGrams.snapshotId, pending.snapshotId))
            .run()
          const grams = shortSearchGrams(body)
          for (
            let offset = 0;
            offset < grams.length;
            offset += SHORT_GRAM_INSERT_BATCH_SIZE
          ) {
            tx.insert(articleSearchShortGrams)
              .values(
                grams
                  .slice(offset, offset + SHORT_GRAM_INSERT_BATCH_SIZE)
                  .map((gram) => ({ snapshotId: pending.snapshotId, gram }))
              )
              .onConflictDoNothing()
              .run()
          }
          tx.delete(articleSearchIndexQueue)
            .where(eq(articleSearchIndexQueue.snapshotId, pending.snapshotId))
            .run()
        }),
      catch: () => failure("Index"),
    }),
  countPending: () =>
    Effect.try({
      try: () =>
        database
          .select({ count: sql<number>`COUNT(*)` })
          .from(articleSearchIndexQueue)
          .get(),
      catch: () => failure("CountPending"),
    }).pipe(
      Effect.flatMap((row) =>
        parse(CountRowSchema)(row).pipe(
          Effect.mapError(() => failure("CountPending", "CorruptRecord"))
        )
      ),
      Effect.map(({ count }) => count)
    ),
  recordFailure: (snapshotId, reason: ArticleSearchIndexFailureReason) =>
    Effect.try({
      try: () =>
        database
          .update(articleSearchIndexQueue)
          .set({
            attempt: sql`${articleSearchIndexQueue.attempt} + 1`,
            lastFailure: reason,
          })
          .where(
            and(
              eq(articleSearchIndexQueue.snapshotId, snapshotId),
              sql`${articleSearchIndexQueue.attempt} < 2147483647`
            )
          )
          .returning({ attempt: articleSearchIndexQueue.attempt })
          .get(),
      catch: () => failure("RecordFailure"),
    }).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.fail(failure("RecordFailure"))
          : Effect.succeed(row.attempt)
      )
    ),
})
