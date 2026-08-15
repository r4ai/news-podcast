import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArchiveCommand, ArticleSnapshot } from "../domain/article.js"
import {
  createArticleArchived,
  createArticleSnapshot,
} from "../domain/article.js"
import type {
  ArchiveArticlePorts,
  ArchiveMessageContext,
  ArchiveStoreError,
  CaptureError,
} from "./ports/archive.js"

export type ArchiveArticleInvocation = DeepReadonly<{
  readonly command: ArchiveCommand
  readonly context: ArchiveMessageContext
}>

export type ArchiveArticleResult =
  | DeepReadonly<{
      readonly _tag: "Archived"
      readonly snapshot: ArticleSnapshot
    }>
  | DeepReadonly<{
      readonly _tag: "AlreadyArchived"
      readonly snapshot: ArticleSnapshot
    }>

export const archiveArticle =
  (ports: ArchiveArticlePorts) =>
  (
    invocation: ArchiveArticleInvocation
  ): Effect.Effect<ArchiveArticleResult, ArchiveStoreError | CaptureError> =>
    ports.lookup(invocation.command.archiveRequestId).pipe(
      Effect.flatMap((lookup) => {
        if (lookup._tag === "Archived") {
          return Effect.succeed(
            deepFreeze({
              _tag: "AlreadyArchived" as const,
              snapshot: deepFreeze(lookup.snapshot),
            })
          )
        }

        const snapshotId = ports.newSnapshotId()
        return ports
          .capture(
            deepFreeze({
              sourceUrl: invocation.command.sourceUrl,
              snapshotId,
            })
          )
          .pipe(
            Effect.map(deepFreeze),
            Effect.flatMap((capture) => {
              const snapshot = createArticleSnapshot({
                command: invocation.command,
                snapshotId,
                capturedAt: ports.now(),
                capture,
              })
              const commitInput = deepFreeze({
                snapshot,
                event: createArticleArchived(snapshot),
                context: invocation.context,
              })

              return ports.commit(commitInput).pipe(
                Effect.map((commit): ArchiveArticleResult =>
                  commit._tag === "Committed"
                    ? deepFreeze({ _tag: "Archived" as const, snapshot })
                    : deepFreeze({
                        _tag: "AlreadyArchived" as const,
                        snapshot: deepFreeze(commit.snapshot),
                      })
                )
              )
            })
          )
      })
    )
