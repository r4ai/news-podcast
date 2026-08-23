import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import {
  contentArticleTags,
  contentEnrichmentQueue,
  contentEnrichmentResults,
  contentTags,
  contentTagSuggestions,
} from "../../../../drizzle/schema.js"
import type { EnrichmentQueueRepository } from "../../../application/enrichment.js"
import { ENRICHMENT_MAX_ATTEMPTS } from "../../../domain/enrichment.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import { failure } from "./row.js"

/**
 * キューの出口側：リースを保持していた実行だけが結果を確定できる。
 * 成功時はタグと候補語彙を同じトランザクションで書き切る。
 * 日次の有料試行枠はprovider送信前にreserveAttemptが確保する。
 */
type Completion = Pick<
  EnrichmentQueueRepository,
  "completeSuccess" | "completeFailure"
>

const STALE_LEASE = "stale enrichment lease"

/** 語彙にない名前だけを候補として数え上げる。 */
const countSuggestions = (
  runner: QueryRunner,
  ownerId: string,
  names: Iterable<string>,
  seenAt: string
) => {
  for (const name of new Set(names)) {
    const inVocabulary = runner
      .select({ name: contentTags.name })
      .from(contentTags)
      .where(and(eq(contentTags.ownerId, ownerId), eq(contentTags.name, name)))
      .get()
    if (inVocabulary !== undefined) continue

    runner
      .insert(contentTagSuggestions)
      .values({ ownerId, name, occurrences: 1, lastSeenAt: seenAt })
      .onConflictDoUpdate({
        target: [contentTagSuggestions.ownerId, contentTagSuggestions.name],
        set: {
          occurrences: sql`${contentTagSuggestions.occurrences} + 1`,
          lastSeenAt: seenAt,
        },
      })
      .run()
  }
}

export const makeCompletion = (
  database: ContentKnowledgeDatabase
): Completion => ({
  completeSuccess: (ownerId, target, output, completedAt) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          // リースを持っている実行だけが結果を確定できる。
          const completed = tx
            .update(contentEnrichmentQueue)
            .set({
              status: "Succeeded",
              leaseToken: null,
              leaseExpiresAt: null,
              completedAt,
              error: null,
            })
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                eq(contentEnrichmentQueue.articleId, target.articleId),
                eq(contentEnrichmentQueue.status, "Processing"),
                eq(contentEnrichmentQueue.leaseToken, target.leaseToken)
              )
            )
            .run()
          if (Number(completed.changes) !== 1) throw new Error(STALE_LEASE)

          const result = {
            status: "Succeeded" as const,
            summary: output.summary,
            score: output.score,
            reason: output.reason,
            error: null,
            tokensIn: output.tokensIn,
            tokensOut: output.tokensOut,
            completedAt,
          }
          tx.insert(contentEnrichmentResults)
            .values({ ownerId, articleId: target.articleId, ...result })
            .onConflictDoUpdate({
              target: [
                contentEnrichmentResults.ownerId,
                contentEnrichmentResults.articleId,
              ],
              set: result,
            })
            .run()

          // AI由来のタグは毎回入れ替える。手動で付けたタグには触れない。
          tx.delete(contentArticleTags)
            .where(
              and(
                eq(contentArticleTags.ownerId, ownerId),
                eq(contentArticleTags.articleId, target.articleId),
                eq(contentArticleTags.source, "Ai")
              )
            )
            .run()

          for (const name of output.tags) {
            tx.insert(contentArticleTags)
              .select(
                tx
                  .select({
                    ownerId: sql`${ownerId}`.as("owner_id"),
                    articleId: sql`${target.articleId}`.as("article_id"),
                    tagId: contentTags.tagId,
                    source: sql`'Ai'`.as("source"),
                    confidence: sql`1`.as("confidence"),
                    createdAt: sql`${completedAt}`.as("created_at"),
                  })
                  .from(contentTags)
                  .where(
                    and(
                      eq(contentTags.ownerId, ownerId),
                      eq(contentTags.name, name)
                    )
                  )
              )
              .onConflictDoNothing({
                target: [
                  contentArticleTags.ownerId,
                  contentArticleTags.articleId,
                  contentArticleTags.tagId,
                ],
              })
              .run()
          }

          countSuggestions(tx, ownerId, output.suggestedTags, completedAt)
        }),
      catch: () => failure("Complete"),
    }).pipe(Effect.asVoid),

  // 再試行できない失敗は、試行回数を上限へ飛ばして即座に終端させる。
  completeFailure: (ownerId, target, error, retryable, completedAt) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          const updated = tx
            .update(contentEnrichmentQueue)
            .set({
              status: "Failed",
              attempt: retryable
                ? sql`${contentEnrichmentQueue.attempt} + 1`
                : ENRICHMENT_MAX_ATTEMPTS,
              leaseToken: null,
              leaseExpiresAt: null,
              completedAt,
              error,
            })
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                eq(contentEnrichmentQueue.articleId, target.articleId),
                eq(contentEnrichmentQueue.status, "Processing"),
                eq(contentEnrichmentQueue.leaseToken, target.leaseToken)
              )
            )
            .run()
          if (Number(updated.changes) !== 1) throw new Error(STALE_LEASE)

          const result = {
            status: "Failed" as const,
            summary: null,
            score: null,
            reason: null,
            error,
            tokensIn: 0,
            tokensOut: 0,
            completedAt,
          }
          tx.insert(contentEnrichmentResults)
            .values({ ownerId, articleId: target.articleId, ...result })
            .onConflictDoUpdate({
              target: [
                contentEnrichmentResults.ownerId,
                contentEnrichmentResults.articleId,
              ],
              set: result,
            })
            .run()
        }),
      catch: () => failure("Complete"),
    }).pipe(Effect.asVoid),
})
