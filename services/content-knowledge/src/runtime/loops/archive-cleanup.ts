import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArchiveStore } from "../../adapters/persistence/archive/repository.js"
import type {
  ArchiveObjectCleanupOutcome,
  HttpS3ArticleCaptureResource,
} from "../../infrastructure/unsafe/http-s3-article-capture.js"

export type ArchiveCleanupConfig = DeepReadonly<{
  readonly intervalMillis: number
  readonly retentionMillis: number
}>

type ArchiveCleanupPorts = Pick<ArchiveStore, "listReferencedSnapshotIds"> &
  Pick<HttpS3ArticleCaptureResource, "cleanupOrphans">

export const runArchiveCleanupCycle = (
  config: Pick<ArchiveCleanupConfig, "retentionMillis">,
  ports: ArchiveCleanupPorts,
  now: () => Date = () => new Date()
) =>
  ports.listReferencedSnapshotIds().pipe(
    Effect.flatMap((snapshotIds) =>
      ports.cleanupOrphans({
        referencedSnapshotIds: new Set(snapshotIds),
        olderThan: new Date(now().getTime() - config.retentionMillis),
      })
    )
  )

export type ArchiveCleanupCycleOutcome = DeepReadonly<
  | {
      readonly _tag: "ArchiveCleanupCycleSucceeded"
      readonly cleanup: ArchiveObjectCleanupOutcome
    }
  | { readonly _tag: "ArchiveCleanupCycleFailed" }
>

export type ArchiveCleanupLoopRuntime = Readonly<{
  readonly wait: (delayMillis: number) => Effect.Effect<void>
  readonly observe: (outcome: ArchiveCleanupCycleOutcome) => Effect.Effect<void>
}>

const liveRuntime: ArchiveCleanupLoopRuntime = Object.freeze({
  wait: Effect.sleep,
  observe: (outcome) =>
    outcome._tag === "ArchiveCleanupCycleSucceeded"
      ? Effect.logInfo("article archive cleanup cycle succeeded", {
          event_name: "article.archive.cleanup.cycle",
          attempted: outcome.cleanup.attempted,
          deleted: outcome.cleanup.deleted,
          delete_failed: outcome.cleanup.failed,
        })
      : Effect.logWarning("article archive cleanup cycle failed", {
          event_name: "article.archive.cleanup.cycle",
        }),
})

/** Reconciles old S3 snapshot prefixes against the SQLite reference set. */
export const runArchiveCleanupLoop = <Failure>(
  config: ArchiveCleanupConfig,
  runCycle: () => Effect.Effect<ArchiveObjectCleanupOutcome, Failure>,
  runtime: Partial<ArchiveCleanupLoopRuntime> = liveRuntime
): Effect.Effect<void> => {
  const wait = runtime.wait ?? liveRuntime.wait
  const observe = runtime.observe ?? liveRuntime.observe
  const loop = (): Effect.Effect<void> =>
    Effect.suspend(runCycle).pipe(
      Effect.matchEffect({
        onFailure: () =>
          observe(deepFreeze({ _tag: "ArchiveCleanupCycleFailed" as const })),
        onSuccess: (cleanup) =>
          observe(
            deepFreeze({
              _tag: "ArchiveCleanupCycleSucceeded" as const,
              cleanup,
            })
          ),
      }),
      Effect.andThen(wait(config.intervalMillis)),
      Effect.andThen(Effect.suspend(loop))
    )
  return loop()
}
