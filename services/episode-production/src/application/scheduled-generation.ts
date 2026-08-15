import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { ArticleId } from "../domain/episode-job.js"

export type DueScheduledGeneration = Readonly<{
  ownerId: string
  localDate: string
}>

export type ScheduledGenerationEvent = Readonly<{
  _tag: "Created" | "Failed"
  ownerId: string
  localDate: string
}>

export type ScheduledGenerationPorts<E = unknown> = Readonly<{
  discoverDue: () => Effect.Effect<readonly DueScheduledGeneration[], E>
  resolveArticleIds: (
    ownerId: string
  ) => Effect.Effect<readonly [ArticleId, ...ArticleId[]], unknown>
  create: (
    ownerId: string,
    idempotencyKey: string,
    articleIds: readonly [ArticleId, ...ArticleId[]]
  ) => Effect.Effect<void, unknown>
  complete: (ownerId: string, localDate: string) => Effect.Effect<void, unknown>
  observe: (event: ScheduledGenerationEvent) => Effect.Effect<void>
}>

/** One bounded pass. A failed owner remains due and is retried on the next pass. */
export const runScheduledGenerationTick = <E>(
  ports: ScheduledGenerationPorts<E>
) =>
  ports.discoverDue().pipe(
    Effect.flatMap((due) =>
      Effect.forEach(
        due,
        (schedule) =>
          ports.resolveArticleIds(schedule.ownerId).pipe(
            Effect.flatMap((articleIds) =>
              ports.create(
                schedule.ownerId,
                `scheduled:${schedule.ownerId}:${schedule.localDate}`,
                articleIds
              )
            ),
            Effect.flatMap(() =>
              ports.complete(schedule.ownerId, schedule.localDate)
            ),
            Effect.flatMap(() =>
              ports.observe({ _tag: "Created", ...schedule })
            ),
            Effect.as(true),
            Effect.matchEffect({
              onFailure: () =>
                ports
                  .observe({ _tag: "Failed", ...schedule })
                  .pipe(Effect.as(false)),
              onSuccess: Effect.succeed,
            })
          ),
        { concurrency: 1 }
      ).pipe(
        Effect.map((results) => {
          const completed = results.filter(Boolean).length
          return deepFreeze({
            discovered: due.length,
            completed,
            failed: due.length - completed,
          })
        })
      )
    ),
    Effect.withSpan("episodeProduction.scheduledGenerationTick")
  )

export const runScheduledGenerationLoop = <E>(
  ports: ScheduledGenerationPorts<E> & {
    wait: (milliseconds: number) => Effect.Effect<void>
  },
  config: { intervalMillis: number; failureBackoffMillis: number },
  signal: AbortSignal
): Effect.Effect<void> => {
  const next = (): Effect.Effect<void> =>
    signal.aborted
      ? Effect.void
      : runScheduledGenerationTick(ports).pipe(
          Effect.matchEffect({
            onFailure: () => ports.wait(config.failureBackoffMillis),
            onSuccess: () => ports.wait(config.intervalMillis),
          }),
          Effect.andThen(Effect.suspend(next))
        )
  return Effect.suspend(next)
}
