import { Effect } from "effect"
import type {
  ArchiveRefreshInput,
  ArchiveRefreshQueue,
} from "../../application/archive-refresh.js"

export type ArchiveRefreshObservation = Readonly<{
  event:
    | "queue"
    | "admitted"
    | "reused"
    | "rejected"
    | "started"
    | "succeeded"
    | "failed"
    | "deadline"
    | "canceled"
  depth?: { queued: number; processing: number; expired: number }
  waitMillis?: number
  reason?: string
}>
export const runArchiveRefreshWorker = (
  queue: ArchiveRefreshQueue,
  execute: (input: ArchiveRefreshInput) => Effect.Effect<unknown, unknown>,
  observe: (value: ArchiveRefreshObservation) => void,
  now: () => string = () => new Date().toISOString()
) => {
  const cycle = (): Effect.Effect<void> =>
    queue.claim(now()).pipe(
      Effect.tap(() =>
        queue
          .stats()
          .pipe(
            Effect.tap((depth) =>
              Effect.sync(() => observe({ event: "queue", depth }))
            )
          )
      ),
      Effect.flatMap((claimed) => {
        if (claimed === undefined) return Effect.void
        return Effect.sync(() =>
          observe({
            event: "started",
            waitMillis: Math.max(
              0,
              Date.parse(now()) - Date.parse(claimed.job.createdAt)
            ),
          })
        ).pipe(
          Effect.andThen(
            execute(claimed).pipe(
              Effect.catchDefect(() =>
                Effect.fail({ _tag: "ArchiveRefreshCaptureDefect" })
              ),
              Effect.timeoutOrElse({
                duration: Math.max(
                  1,
                  Math.min(
                    30_000,
                    Date.parse(claimed.deadlineAt) - Date.parse(now())
                  )
                ),
                orElse: () => Effect.fail({ _tag: "ArchiveRefreshDeadline" }),
              }),
              Effect.matchEffect({
                onSuccess: () =>
                  queue
                    .complete(claimed.job.jobId, null, now())
                    .pipe(
                      Effect.tap(() =>
                        Effect.sync(() => observe({ event: "succeeded" }))
                      )
                    ),
                onFailure: (error) => {
                  const deadline =
                    typeof error === "object" &&
                    error !== null &&
                    "_tag" in error &&
                    error._tag === "ArchiveRefreshDeadline"
                  return queue
                    .complete(
                      claimed.job.jobId,
                      deadline ? "deadline" : "capture",
                      now()
                    )
                    .pipe(
                      Effect.tap(() =>
                        Effect.sync(() =>
                          observe({ event: deadline ? "deadline" : "failed" })
                        )
                      )
                    )
                },
              }),
              Effect.onInterrupt(() =>
                queue
                  .complete(claimed.job.jobId, "canceled", now())
                  .pipe(
                    Effect.ignore,
                    Effect.andThen(
                      Effect.sync(() => observe({ event: "canceled" }))
                    )
                  )
              )
            )
          )
        )
      }),
      Effect.catch(() =>
        Effect.logWarning("archive refresh worker failed", {
          event_name: "archive.refresh.worker_failed",
        })
      ),
      Effect.asVoid
    )
  const loop = (): Effect.Effect<void> =>
    cycle().pipe(
      Effect.andThen(Effect.sleep(100)),
      Effect.andThen(Effect.suspend(loop))
    )
  return loop()
}
