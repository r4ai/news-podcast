import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { MarkdownObjectReader } from "./ports/article-catalog.js"
import type { ObjectKey } from "../domain/article.js"

export type ArticleSearchIndexFailureReason =
  | "CorruptObject"
  | "NotFound"
  | "ResourceLimit"
  | "Unavailable"

export type PendingArticleSearchIndex = DeepReadonly<{
  readonly snapshotId: string
  readonly articleId: string
  readonly markdownKey: ObjectKey
  readonly attempt: number
  readonly lastFailure: ArticleSearchIndexFailureReason | null
}>

export type ArticleSearchIndexStoreError = DeepReadonly<{
  readonly _tag: "ArticleSearchIndexStoreFailed"
  readonly operation: "ListPending" | "Index" | "CountPending" | "RecordFailure"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type ArticleSearchIndexRepository = DeepReadonly<{
  readonly listPending: (
    limit: number
  ) => Effect.Effect<
    readonly PendingArticleSearchIndex[],
    ArticleSearchIndexStoreError
  >
  readonly index: (input: {
    readonly pending: PendingArticleSearchIndex
    readonly body: string
  }) => Effect.Effect<void, ArticleSearchIndexStoreError>
  readonly countPending: () => Effect.Effect<
    number,
    ArticleSearchIndexStoreError
  >
  readonly recordFailure: (
    snapshotId: string,
    reason: ArticleSearchIndexFailureReason
  ) => Effect.Effect<number, ArticleSearchIndexStoreError>
}>

export type ArticleSearchIndexObserver = Readonly<{
  readonly indexed: (event: { readonly snapshotId: string }) => void
  readonly failed: (event: {
    readonly snapshotId: string
    readonly reason: ArticleSearchIndexFailureReason
    readonly attempt: number
  }) => void
  readonly backlog: (event: { readonly depth: number }) => void
}>

const noopObserver: ArticleSearchIndexObserver = Object.freeze({
  indexed: () => undefined,
  failed: () => undefined,
  backlog: () => undefined,
})

const observe = (action: () => void): void => {
  try {
    action()
  } catch {
    // Telemetry is deliberately outside the indexing contract.
  }
}

/** Processes a bounded durable batch; object failures stay queued for retry. */
export const runArticleSearchIndexCycle = (
  dependencies: Readonly<{
    readonly repository: ArticleSearchIndexRepository
    readonly objects: Pick<MarkdownObjectReader, "read">
    readonly observer?: ArticleSearchIndexObserver
  }>,
  limit: number
) =>
  dependencies.repository.listPending(limit).pipe(
    Effect.flatMap((pending) =>
      Effect.forEach(
        pending,
        (entry) => {
          const observer = dependencies.observer ?? noopObserver
          return dependencies.objects.read(entry.markdownKey).pipe(
            Effect.matchEffect({
              onFailure: (objectFailure) =>
                dependencies.repository
                  .recordFailure(entry.snapshotId, objectFailure.reason)
                  .pipe(
                    Effect.tap((attempt) =>
                      Effect.sync(() =>
                        observe(() =>
                          observer.failed({
                            snapshotId: entry.snapshotId,
                            reason: objectFailure.reason,
                            attempt,
                          })
                        )
                      )
                    ),
                    Effect.as("Failed" as const)
                  ),
              onSuccess: (body) =>
                dependencies.repository.index({ pending: entry, body }).pipe(
                  Effect.tap(() =>
                    Effect.sync(() =>
                      observe(() =>
                        observer.indexed({ snapshotId: entry.snapshotId })
                      )
                    )
                  ),
                  Effect.as("Indexed" as const)
                ),
            })
          )
        },
        { concurrency: 1 }
      )
    ),
    Effect.tap(() =>
      dependencies.repository.countPending().pipe(
        Effect.tap((depth) =>
          Effect.sync(() => {
            const observer = dependencies.observer ?? noopObserver
            observe(() => observer.backlog({ depth }))
          })
        )
      )
    ),
    Effect.map((results) =>
      deepFreeze({
        processed: results.length,
        indexed: results.filter((result) => result === "Indexed").length,
        failed: results.filter((result) => result === "Failed").length,
      })
    )
  )
