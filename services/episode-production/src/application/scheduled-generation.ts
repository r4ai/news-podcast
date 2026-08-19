import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { EpisodeJob } from "../domain/episode-job.js"

export type DueScheduledGeneration = Readonly<{
  ownerId: string
  localDate: string
}>

export type ScheduledGenerationEvent = Readonly<{
  _tag: "Succeeded" | "Retrying" | "Missed" | "Failed"
  ownerId: string
  localDate: string
}>

export type ScheduledGenerationPorts<E = unknown> = Readonly<{
  discoverDue: () => Effect.Effect<readonly DueScheduledGeneration[], E>
  create: (
    ownerId: string,
    idempotencyKey: string
  ) => Effect.Effect<EpisodeJob, unknown>
  complete: (ownerId: string, localDate: string) => Effect.Effect<void, unknown>
  observe: (event: ScheduledGenerationEvent) => Effect.Effect<void>
}>

type ScheduleOutcome = "succeeded" | "retrying" | "missed" | "failed"

const reconcileJob = (
  ports: ScheduledGenerationPorts<unknown>,
  schedule: DueScheduledGeneration,
  job: EpisodeJob
): Effect.Effect<Exclude<ScheduleOutcome, "failed">, unknown> => {
  switch (job._tag) {
    case "Queued":
    case "Running":
    case "Retrying":
      return ports
        .observe({ _tag: "Retrying", ...schedule })
        .pipe(Effect.as("retrying" as const))
    case "Succeeded":
      return ports
        .complete(schedule.ownerId, schedule.localDate)
        .pipe(
          Effect.andThen(ports.observe({ _tag: "Succeeded", ...schedule })),
          Effect.as("succeeded" as const)
        )
    case "Canceled":
      if (job.reason === "service_shutdown") {
        return ports
          .observe({ _tag: "Retrying", ...schedule })
          .pipe(Effect.as("retrying" as const))
      }
      return ports
        .complete(schedule.ownerId, schedule.localDate)
        .pipe(
          Effect.andThen(ports.observe({ _tag: "Missed", ...schedule })),
          Effect.as("missed" as const)
        )
    case "Failed":
      return ports
        .complete(schedule.ownerId, schedule.localDate)
        .pipe(
          Effect.andThen(ports.observe({ _tag: "Missed", ...schedule })),
          Effect.as("missed" as const)
        )
  }
}

/** One bounded pass. Active work remains due; only terminal outcomes close the local day. */
export const runScheduledGenerationTick = <E>(
  ports: ScheduledGenerationPorts<E>
) =>
  ports.discoverDue().pipe(
    Effect.flatMap((due) =>
      Effect.forEach(
        due,
        (schedule) =>
          ports
            .create(
              schedule.ownerId,
              `scheduled:${schedule.ownerId}:${schedule.localDate}`
            )
            .pipe(
              Effect.flatMap((job) => reconcileJob(ports, schedule, job)),
              Effect.matchEffect({
                onFailure: () =>
                  ports
                    .observe({ _tag: "Failed", ...schedule })
                    .pipe(Effect.as("failed" as const)),
                onSuccess: Effect.succeed,
              })
            ),
        { concurrency: 1 }
      ).pipe(
        Effect.map((results: readonly ScheduleOutcome[]) => {
          const count = (outcome: ScheduleOutcome) =>
            results.filter((result) => result === outcome).length
          return deepFreeze({
            discovered: due.length,
            succeeded: count("succeeded"),
            retrying: count("retrying"),
            missed: count("missed"),
            failed: count("failed"),
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
